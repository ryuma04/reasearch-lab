package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

// Tools that change files, run code, spend resources or publish need the editor role; every other tool needs viewer.
var editorTools = map[string]bool{
	"paper_upload_or_link": true, "lab_start_run": true, "workspace_write_file": true,
	"sandbox_execute": true, "sandbox_run_tests": true, "sandbox_cancel": true,
	"debugger_propose_patch": true, "debugger_apply_and_rerun": true,
	"experiment_launch": true, "memory_store": true,
	"publish_generate_model_card": true, "publish_to_github": true, "publish_to_huggingface": true, "publish_validate_artifacts": true,
	"task_cancel": true, "task_resume": true, "task_request_approval": true,
}

var roleRank = map[string]int{"viewer": 1, "editor": 2, "owner": 3}

// idLookups maps an argument name to the query that finds the workspace the referenced object belongs to.
var idLookups = []struct{ arg, sql string }{
	{"run_id", `SELECT workspace_id FROM runs WHERE id=$1`},
	{"exec_id", `SELECT r.workspace_id FROM sandbox_execs e JOIN runs r ON r.id=e.run_id WHERE e.id=$1`},
	{"task_id", `SELECT workspace_id FROM mcp_tasks WHERE id=$1`},
	{"paper_id", `SELECT workspace_id FROM papers WHERE id=$1`},
	{"claim_id", `SELECT p.workspace_id FROM claims c JOIN papers p ON p.id=c.paper_id WHERE c.id=$1`},
	{"workspace_id", `SELECT id FROM workspaces WHERE id=$1`},
}

// authorize checks that the session's user may use `tool` on every run/workspace/task the arguments refer to.
// Non-members get "not found" so ids of other users' workspaces are not revealed.
func (srv *Server) authorize(ctx context.Context, tool string, args json.RawMessage) error {
	if srv.user == nil || srv.user.ID <= 0 {
		return errors.New("unauthorized")
	}
	var in map[string]any
	if len(args) > 0 {
		if err := json.Unmarshal(args, &in); err != nil {
			return nil // malformed arguments are rejected by the tool's schema validation
		}
	}
	need := "viewer"
	if editorTools[tool] {
		need = "editor"
	}
	for _, l := range idLookups {
		v, ok := in[l.arg].(float64)
		if !ok || v <= 0 {
			continue
		}
		var wsID int64
		if err := srv.store.Pool.QueryRow(ctx, l.sql, int64(v)).Scan(&wsID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%s %d not found", l.arg, int64(v))
			}
			return err
		}
		ws, err := srv.store.WorkspaceForUser(ctx, wsID, srv.user.ID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return fmt.Errorf("%s %d not found", l.arg, int64(v))
			}
			return err
		}
		if roleRank[ws.Role] < roleRank[need] {
			return fmt.Errorf("%s needs the %s role in this workspace (you are %s)", tool, need, ws.Role)
		}
	}
	return nil
}

// authzMiddleware runs authorize before every tools/call and answers a refused call as a tool error the model can read.
func (srv *Server) authzMiddleware(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		if method != "tools/call" {
			return next(ctx, method, req)
		}
		call, ok := req.(*mcp.CallToolRequest)
		if !ok || call.Params == nil {
			return next(ctx, method, req)
		}
		if err := srv.authorize(ctx, call.Params.Name, call.Params.Arguments); err != nil {
			uid := int64(0)
			if srv.user != nil {
				uid = srv.user.ID
			}
			slog.Warn("mcp tool call refused", "tool", call.Params.Name, "user", uid, "reason", err.Error())
			return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: "access denied: " + err.Error()}}}, nil
		}
		return next(ctx, method, req)
	}
}
