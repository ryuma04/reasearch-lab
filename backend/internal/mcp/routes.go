package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
)

type Service struct {
	cfg          *config.Config
	store        *store.Store
	bus          *bus.Bus
	sandbox      *sandbox.Service
	orchestrator *Orchestrator
}

func NewService(cfg *config.Config, st *store.Store, b *bus.Bus, sbx *sandbox.Service) *Service {
	return &Service{
		cfg:          cfg,
		store:        st,
		bus:          b,
		sandbox:      sbx,
		orchestrator: NewOrchestrator(cfg, st, b, sbx),
	}
}

func (s *Service) resolveUser(req *http.Request) (*store.User, error) {
	ctx := req.Context()
	uid := auth.UserID(ctx)
	if uid > 0 {
		return s.store.UserByID(ctx, uid)
	}

	authHeader := req.Header.Get("Authorization")
	internalHeader := req.Header.Get("X-Internal-Token")
	if (authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") && strings.TrimPrefix(authHeader, "Bearer ") == s.cfg.InternalToken) ||
		(internalHeader != "" && internalHeader == s.cfg.InternalToken) ||
		s.cfg.DevLoginEnabled {
		return &store.User{ID: 1, Name: "Developer", Email: "dev@research.local"}, nil
	}

	return nil, httpx.ErrUnauthorized
}

func (s *Service) userFromCtx(ctx context.Context) (*store.User, error) {
	uid := auth.UserID(ctx)
	if uid <= 0 {
		if s.cfg.DevLoginEnabled {
			return &store.User{ID: 1, Name: "Developer", Email: "dev@research.local"}, nil
		}
		return nil, httpx.ErrUnauthorized
	}
	return s.store.UserByID(ctx, uid)
}

// Routes registers MCP and AI Assistant routes.
func (s *Service) Routes(r chi.Router) {
	h := httpx.Handler

	// Production MCP Streamable HTTP endpoint for external clients (Gemini CLI, Claude Code, Cursor)
	r.HandleFunc("/mcp", func(w http.ResponseWriter, req *http.Request) {
		u, err := s.resolveUser(req)
		if err != nil || u == nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		Handler(s.cfg, s.store, s.bus, s.sandbox)(w, req.WithContext(WithUser(req.Context(), u)))
	})

	// Assistant UI API (allows both session auth and external dev discovery)
	r.HandleFunc("/assistant/tools", func(w http.ResponseWriter, r *http.Request) {
		_ = s.ListTools(w, r)
	})
	r.Post("/runs/{id}/assistant/task", h(s.CreateTask))
	r.Get("/runs/{id}/assistant/tasks", h(s.ListTasks))
	r.Get("/assistant/tasks/{taskId}", h(s.GetTask))
	r.Post("/assistant/tasks/{taskId}/approve", h(s.ApproveTask))
	r.Post("/assistant/tasks/{taskId}/cancel", h(s.CancelTask))
}

// GET /assistant/tools - returns tool discovery definitions
func (s *Service) ListTools(w http.ResponseWriter, r *http.Request) error {
	tools := s.orchestrator.availableTools()
	httpx.JSON(w, http.StatusOK, map[string]any{
		"tools": tools,
		"count": len(tools),
	})
	return nil
}

// POST /runs/{id}/assistant/task {"prompt": "..."}
func (s *Service) CreateTask(w http.ResponseWriter, r *http.Request) error {
	runID, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	run, err := s.store.RunByID(r.Context(), runID)
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, "editor"); err != nil {
		return err
	}

	var body struct {
		Prompt string `json:"prompt"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}

	u, err := s.userFromCtx(r.Context())
	if err != nil || u == nil {
		return httpx.ErrUnauthorized
	}

	task, err := s.orchestrator.StartTask(r.Context(), run.WorkspaceID, &run.ID, u, body.Prompt)
	if err != nil {
		return err
	}

	httpx.JSON(w, http.StatusAccepted, task)
	return nil
}

// GET /runs/{id}/assistant/tasks
func (s *Service) ListTasks(w http.ResponseWriter, r *http.Request) error {
	runID, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	run, err := s.store.RunByID(r.Context(), runID)
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, "viewer"); err != nil {
		return err
	}

	rows, err := s.store.Pool.Query(r.Context(), `
		SELECT id, workspace_id, run_id, user_id, prompt, status, model, steps_count, tokens_used,
		       coalesce(approval_payload, '{}'::jsonb), result, error, created_at, updated_at
		FROM mcp_tasks
		WHERE run_id = $1
		ORDER BY id DESC LIMIT 50`, run.ID)
	if err != nil {
		return err
	}
	defer rows.Close()

	tasks := make([]MCPTask, 0)
	for rows.Next() {
		var t MCPTask
		if rows.Scan(&t.ID, &t.WorkspaceID, &t.RunID, &t.UserID, &t.Prompt, &t.Status, &t.Model, &t.StepsCount,
			&t.TokensUsed, &t.ApprovalPayload, &t.Result, &t.Error, &t.CreatedAt, &t.UpdatedAt) == nil {
			tasks = append(tasks, t)
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"tasks": tasks})
	return nil
}

// GET /assistant/tasks/{taskId}
func (s *Service) GetTask(w http.ResponseWriter, r *http.Request) error {
	taskID, err := httpx.IDParam(r, "taskId")
	if err != nil {
		return err
	}

	u, err := s.userFromCtx(r.Context())
	if err != nil || u == nil {
		return httpx.ErrUnauthorized
	}

	srv := NewServer(s.cfg, s.store, s.bus, s.sandbox, u)
	task, err := srv.loadTask(r.Context(), taskID)
	if err != nil {
		return httpx.Errorf(http.StatusNotFound, "task not found")
	}

	if _, err := workspace.Access(r.Context(), s.store, task.WorkspaceID, "viewer"); err != nil {
		return err
	}

	httpx.JSON(w, http.StatusOK, task)
	return nil
}

// POST /assistant/tasks/{taskId}/approve {"approved": true}
func (s *Service) ApproveTask(w http.ResponseWriter, r *http.Request) error {
	taskID, err := httpx.IDParam(r, "taskId")
	if err != nil {
		return err
	}

	var body struct {
		Approved bool `json:"approved"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}

	u, err := s.userFromCtx(r.Context())
	if err != nil || u == nil {
		return httpx.ErrUnauthorized
	}

	srv := NewServer(s.cfg, s.store, s.bus, s.sandbox, u)
	task, err := srv.loadTask(r.Context(), taskID)
	if err != nil {
		return httpx.Errorf(http.StatusNotFound, "task not found")
	}
	if _, err := workspace.Access(r.Context(), s.store, task.WorkspaceID, "editor"); err != nil {
		return err
	}

	if !body.Approved {
		_, _ = s.store.Pool.Exec(r.Context(), `UPDATE mcp_tasks SET status='failed', error='Action rejected by researcher', updated_at=now() WHERE id=$1`, task.ID)
		httpx.JSON(w, http.StatusOK, map[string]any{"task_id": task.ID, "status": "failed", "message": "Action rejected"})
		return nil
	}

	// If approved, parse the approval payload and execute the gated action
	var payload map[string]any
	_ = json.Unmarshal(task.ApprovalPayload, &payload)
	payload["approved"] = true

	// Check action tool name from payload
	toolName := "publish_to_huggingface"
	if _, ok := payload["repo_name"]; !ok {
		toolName = "publish_to_github"
	}

	toolResult, err := s.orchestrator.dispatchTool(r.Context(), srv, toolName, payload)
	errMsg := ""
	status := "completed"
	if err != nil {
		status = "failed"
		errMsg = err.Error()
	}

	resultBytes, _ := json.Marshal(toolResult)
	_, _ = s.store.Pool.Exec(r.Context(), `
		UPDATE mcp_tasks
		SET status=$1, result=$2, error=$3, updated_at=now()
		WHERE id=$4`, status, string(resultBytes), errMsg, task.ID)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"task_id": task.ID,
		"status":  status,
		"result":  toolResult,
	})
	return nil
}

// POST /assistant/tasks/{taskId}/cancel
func (s *Service) CancelTask(w http.ResponseWriter, r *http.Request) error {
	taskID, err := httpx.IDParam(r, "taskId")
	if err != nil {
		return err
	}

	u, err := s.userFromCtx(r.Context())
	if err != nil || u == nil {
		return httpx.ErrUnauthorized
	}

	srv := NewServer(s.cfg, s.store, s.bus, s.sandbox, u)
	res, err := srv.handleTaskCancel(r.Context(), TaskCancelIn{TaskID: taskID})
	if err != nil {
		return err
	}

	httpx.JSON(w, http.StatusOK, res)
	return nil
}
