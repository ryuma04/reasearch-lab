// Package runs handles runs: start, live stream (SSE), replay, checkpoints, agent controls,
// results (scorecard, settings, metrics, map, gap analysis, what-ifs, files) and Lab Memory search.
package runs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/agentsclient"
	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
	"github.com/ryuma04/tapu-sena/backend/internal/workspace"
)

// AgentInfo describes one fixed agent of the pipeline (mirrors agents/lab/steps.py AGENTS).
type AgentInfo struct {
	ID          string `json:"id"`    // the agent string used in events, e.g. coding.writer
	Group       string `json:"group"` // card on the Live Agent Board, e.g. coding
	Name        string `json:"name"`
	Description string `json:"description"`
}

// AgentList is the fixed pipeline, in order (GET /agents).
var AgentList = []AgentInfo{
	{"research.paper_reader", "research", "Paper Reader", "Reads the paper (arXiv LaTeX source, then PDF) and builds the Claims List with page numbers."},
	{"research.source_finder", "research", "Source Finder", "Finds and checks the code, datasets and related papers."},
	{"coding.writer", "coding", "Code Writer", "Writes the project; every script writes results/metrics.json."},
	{"coding.reviewer", "coding", "Code Reviewer and Debugger", "Reviews code against the brief and fixes errors, Lab Memory first."},
	{"testing.designer", "testing", "Test Designer", "Writes correctness tests and claim tests."},
	{"testing.runner", "testing", "Test Runner", "Runs the tests in the sandbox and fills the Claim Scorecard."},
	{"gap_detective", "gap_detective", "Gap Detective", "Tests why a result differs from the paper with one-change experiments."},
	{"whatif", "whatif", "What-If Planner", "Turns a what-if question into branches with successive halving."},
	{"observer", "observer", "Observer", "Draws the live Research Map from every event."},
}

// KnownAgent accepts a full agent id (coding.writer) or a board card group (coding).
func KnownAgent(agent string) bool {
	for _, a := range AgentList {
		if a.ID == agent || a.Group == agent {
			return true
		}
	}
	return false
}

type Service struct {
	cfg    *config.Config
	store  *store.Store
	bus    *bus.Bus
	agents *agentsclient.Client
}

func New(cfg *config.Config, st *store.Store, b *bus.Bus, ac *agentsclient.Client) *Service {
	return &Service{cfg: cfg, store: st, bus: b, agents: ac}
}

// loadRun loads a run and checks the user's role in its workspace.
func (s *Service) loadRun(r *http.Request, minRole string) (*store.Run, *store.Workspace, error) {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return nil, nil, err
	}
	run, err := s.store.RunByID(r.Context(), id)
	if err != nil {
		return nil, nil, err
	}
	ws, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, minRole)
	if err != nil {
		return nil, nil, err
	}
	return run, ws, nil
}

func (s *Service) event(ctx context.Context, runID int64, agent, typ, msg, why string, links map[string]any) {
	var l json.RawMessage
	if links != nil {
		l, _ = json.Marshal(links)
	}
	s.bus.Emit(ctx, store.Event{RunID: runID, Agent: agent, Type: typ, Message: msg, Why: why, Links: l})
}

// ---------- lifecycle ----------

// POST /workspaces/{id}/runs {"compute_budget": "quick|standard|deep"}
func (s *Service) Start(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	wsID, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	ws, err := workspace.Access(ctx, s.store, wsID, "editor")
	if err != nil {
		return err
	}
	var body struct {
		ComputeBudget string `json:"compute_budget"`
	}
	if r.ContentLength > 0 {
		if err := httpx.Decode(r, &body); err != nil {
			return err
		}
	}
	budget := body.ComputeBudget
	if budget == "" {
		budget = ws.ComputeBudget
	}
	if budget != "quick" && budget != "standard" && budget != "deep" {
		return httpx.Errorf(http.StatusBadRequest, "compute_budget must be quick, standard or deep")
	}
	n, err := s.store.CountPapers(ctx, wsID)
	if err != nil {
		return err
	}
	if n == 0 {
		return httpx.Errorf(http.StatusBadRequest, "upload at least one research paper before starting a run")
	}
	run, err := s.store.CreateRun(ctx, wsID, budget)
	if err != nil {
		return err
	}
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "start_run", "run_id": run.ID, "user_id": auth.UserID(ctx)}); err != nil {
		_ = s.store.SetRunStatus(ctx, run.ID, "failed", "", "could not queue the run: "+err.Error())
		return err
	}
	s.event(ctx, run.ID, "system", "run_queued",
		fmt.Sprintf("Run #%d queued with the %s budget", run.ID, budget),
		"The researcher started a run; the Research Agent reads the paper first", nil)
	httpx.JSON(w, http.StatusCreated, run)
	return nil
}

// GET /workspaces/{id}/runs
func (s *Service) ListForWorkspace(w http.ResponseWriter, r *http.Request) error {
	wsID, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, wsID, "viewer"); err != nil {
		return err
	}
	list, err := s.store.RunsForWorkspace(r.Context(), wsID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, list)
	return nil
}

// GET /runs/{id}
func (s *Service) Get(w http.ResponseWriter, r *http.Request) error {
	run, ws, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	return s.writeRunDetail(w, r, run, ws)
}

func (s *Service) writeRunDetail(w http.ResponseWriter, r *http.Request, run *store.Run, ws *store.Workspace) error {
	ctx := r.Context()
	cps, err := s.store.Checkpoints(ctx, run.ID)
	if err != nil {
		return err
	}
	children, err := s.store.ChildRuns(ctx, run.ID)
	if err != nil {
		return err
	}
	var pending *store.Checkpoint
	for i := range cps {
		if cps[i].Status == "pending" {
			pending = &cps[i]
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"run": run, "workspace": map[string]any{"id": ws.ID, "title": ws.Title},
		"checkpoints": cps, "pending_checkpoint": pending, "children": children,
		"stages": []string{"research", "plan_approval", "coding", "testing", "gap", "whatif", "push", "done"},
	})
	return nil
}

// ---------- events: live stream and replay ----------

// GET /runs/{id}/events?after=<event id>&limit=500 — saved events for Run Replay.
func (s *Service) Events(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	return s.writeEvents(w, r, run.ID)
}

func (s *Service) writeEvents(w http.ResponseWriter, r *http.Request, runID int64) error {
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	evs, err := s.store.EventsAfter(r.Context(), runID, after, limit, true)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, evs)
	return nil
}

// GET /runs/{id}/stream — Server-Sent Events. Sends missed events first (Last-Event-ID or
// ?after=), then live ones. Each SSE message: "id: <event id>\nevent: <type>\ndata: <json>".
func (s *Service) Stream(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	return s.stream(w, r, run.ID)
}

func (s *Service) stream(w http.ResponseWriter, r *http.Request, runID int64) error {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return httpx.Errorf(http.StatusInternalServerError, "streaming not supported")
	}
	ctx := r.Context()
	after, _ := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64)
	if q := r.URL.Query().Get("after"); q != "" {
		after, _ = strconv.ParseInt(q, 10, 64)
	}

	// Subscribe before replaying so nothing is missed in between.
	ch, unsubscribe := s.bus.Subscribe(runID)
	defer unsubscribe()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "retry: 3000\n\n")

	// Events are sent as unnamed SSE messages: an EventSource only delivers named events to
	// listeners registered for that exact name, so naming them by type silently dropped every
	// type the browser did not know in advance (audit INT-07). The type is inside the JSON.
	send := func(e store.Event) {
		data, _ := json.Marshal(e)
		fmt.Fprintf(w, "id: %d\ndata: %s\n\n", e.ID, data)
	}
	last := after
	for {
		backlog, err := s.store.EventsAfter(ctx, runID, last, 1000, true)
		if err != nil {
			return nil
		}
		for _, e := range backlog {
			send(e)
			last = e.ID
		}
		if len(backlog) < 1000 {
			break
		}
	}
	flusher.Flush()

	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case e := <-ch:
			if e.ID <= last {
				continue
			}
			send(e)
			last = e.ID
			flusher.Flush()
		case <-ping.C:
			// A real (named) heartbeat event, so the client can tell a quiet run from a dead connection.
			fmt.Fprintf(w, "event: heartbeat\ndata: {\"type\":\"heartbeat\",\"run_id\":%d,\"time\":%q}\n\n",
				runID, time.Now().UTC().Format(time.RFC3339))
			flusher.Flush()
		}
	}
}

// ---------- checkpoints ----------

// GET /runs/{id}/checkpoints
func (s *Service) Checkpoints(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	cps, err := s.store.Checkpoints(r.Context(), run.ID)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, cps)
	return nil
}

type CheckpointResponse struct {
	Action      string `json:"action"` // approve | edit | reject
	Instruction string `json:"instruction,omitempty"`
	Option      string `json:"option,omitempty"`
	// Changes are exact setting edits at the plan checkpoint ({"train.epochs_student": 10});
	// the agent worker validates the names against the run's settings.
	Changes map[string]any `json:"changes,omitempty"`
}

// POST /runs/{id}/checkpoints/{name} {"action": "approve|edit|reject", "instruction": "...", "option": "..."}
func (s *Service) ResolveCheckpoint(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var body CheckpointResponse
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	cp, err := s.Resolve(r.Context(), run.ID, chiParam(r, "name"), body, auth.UserID(r.Context()), "web")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, cp)
	return nil
}

// Resolve resolves a checkpoint (web and voice commands).
func (s *Service) Resolve(ctx context.Context, runID int64, name string, body CheckpointResponse, userID int64, via string) (*store.Checkpoint, error) {
	status := map[string]string{"approve": "approved", "edit": "edited", "reject": "rejected"}[body.Action]
	if status == "" {
		return nil, httpx.Errorf(http.StatusBadRequest, "action must be approve, edit or reject")
	}
	if body.Action == "edit" && strings.TrimSpace(body.Instruction) == "" && len(body.Changes) == 0 {
		return nil, httpx.Errorf(http.StatusBadRequest, "edit needs an instruction or setting changes, e.g. \"use only 10,000 training images\"")
	}
	if err := ValidateSettingChanges(body.Changes); err != nil {
		return nil, err
	}
	resp := map[string]any{"action": body.Action, "instruction": body.Instruction, "option": body.Option, "user_id": userID, "via": via}
	if len(body.Changes) > 0 {
		resp["changes"] = body.Changes
	}
	cp, err := s.store.ResolveCheckpoint(ctx, runID, name, status, resp)
	if err == store.ErrNotFound {
		return nil, httpx.Errorf(http.StatusConflict, "no pending checkpoint named "+name+" for this run")
	}
	if err != nil {
		return nil, err
	}
	// The worker only continues when it receives the resume job. If that cannot be queued, put the
	// checkpoint back to pending so the researcher can answer again (audit REL-03).
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "resume", "run_id": runID, "checkpoint": name, "response": resp}); err != nil {
		_ = s.store.ReopenCheckpoint(context.WithoutCancel(ctx), cp.ID)
		return nil, httpx.Errorf(http.StatusServiceUnavailable, "could not reach the agent worker; try again")
	}
	if err := s.store.SetRunStatus(ctx, runID, "running", "", ""); err != nil {
		return nil, err
	}
	msg := fmt.Sprintf("Researcher %s the %s checkpoint", status, name)
	if body.Instruction != "" {
		msg += ": " + body.Instruction
	}
	s.event(ctx, runID, "researcher", "checkpoint_resolved", msg, "Decision made via "+via,
		map[string]any{"checkpoint": name, "action": body.Action, "option": body.Option})
	return cp, nil
}

// ---------- agent controls ----------

// POST /runs/{id}/agents/{agent}/action {"action": "...", "text": "..."}
// actions: pause | resume | stop | retry | instruct
// Use agent "run" for whole-run controls; pause/stop always apply at the next safe step.
func (s *Service) AgentAction(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		Action string `json:"action"`
		Text   string `json:"text"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	res, err := s.Act(r.Context(), run, chiParam(r, "agent"), body.Action, body.Text, "web")
	if err == nil {
		res["accepted"] = true
	}
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, res)
	return nil
}

func (s *Service) Act(ctx context.Context, run *store.Run, agent, action, text, via string) (map[string]any, error) {
	if agent == "" {
		agent = "run"
	}
	if agent != "run" && !KnownAgent(agent) {
		return nil, httpx.Errorf(http.StatusNotFound, "unknown agent "+agent)
	}
	finished := run.Status == "completed" || run.Status == "failed" || run.Status == "stopped" || run.Status == "rejected"
	res := map[string]any{"run_id": run.ID, "agent": agent, "action": action}
	switch action {
	case "pause":
		if finished {
			return nil, httpx.Errorf(http.StatusConflict, "run is already "+run.Status)
		}
		if err := s.bus.SetControl(ctx, run.ID, "pause"); err != nil {
			return nil, err
		}
		_ = s.store.SetRunStatus(ctx, run.ID, "paused", "", "")
		s.event(ctx, run.ID, agent, "paused", "Paused by the researcher", "Work stops at the next safe step", nil)
	case "resume":
		if err := s.bus.SetControl(ctx, run.ID, ""); err != nil {
			return nil, err
		}
		if run.Status == "paused" {
			_ = s.store.SetRunStatus(ctx, run.ID, "running", "", "")
		}
		s.event(ctx, run.ID, agent, "resumed", "Resumed by the researcher", "", nil)
	case "stop":
		if finished {
			return nil, httpx.Errorf(http.StatusConflict, "run is already "+run.Status)
		}
		if err := s.bus.SetControl(ctx, run.ID, "stop"); err != nil {
			return nil, err
		}
		if run.Status == "waiting_approval" || run.Status == "queued" || run.Status == "paused" {
			_ = s.store.SetRunStatus(ctx, run.ID, "stopped", "", "stopped by the researcher")
		}
		s.event(ctx, run.ID, agent, "stop_requested", "Stop requested by the researcher", "", nil)
	case "retry":
		if !finished && run.Status != "paused" {
			return nil, httpx.Errorf(http.StatusConflict, "only failed, stopped or paused runs can be retried")
		}
		if err := s.bus.SetControl(ctx, run.ID, ""); err != nil {
			return nil, err
		}
		_ = s.store.SetRunStatus(ctx, run.ID, "queued", "", "")
		if err := s.bus.Enqueue(ctx, map[string]any{"type": "retry", "run_id": run.ID, "agent": agent}); err != nil {
			return nil, err
		}
		s.event(ctx, run.ID, agent, "retry_requested", "Retry requested by the researcher", "Continues from the last saved step", nil)
	case "instruct":
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, httpx.Errorf(http.StatusBadRequest, "text is required for instruct")
		}
		if err := s.bus.PushInstruction(ctx, run.ID, agent, text); err != nil {
			return nil, err
		}
		s.event(ctx, run.ID, "researcher", "instruction_given", "Instruction for "+agent+": "+text, "Given via "+via,
			map[string]any{"agent": agent})
	default:
		return nil, httpx.Errorf(http.StatusBadRequest, "action must be pause, resume, stop, retry or instruct")
	}
	return res, nil
}

// ---------- what-if ----------

// POST /runs/{id}/whatif {"question": "What if the temperature is 2, 5, 10 or 20?"}
func (s *Service) AskWhatIf(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "editor")
	if err != nil {
		return err
	}
	var body struct {
		Question string `json:"question"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	qid, err := s.WhatIf(r.Context(), run, body.Question, auth.UserID(r.Context()), "web")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{"question_id": qid, "status": "queued"})
	return nil
}

func (s *Service) WhatIf(ctx context.Context, run *store.Run, question string, userID int64, via string) (string, error) {
	question = strings.TrimSpace(question)
	if len(question) < 5 || len(question) > 1000 {
		return "", httpx.Errorf(http.StatusBadRequest, "question must be between 5 and 1000 characters")
	}
	if run.Kind != "main" {
		return "", httpx.Errorf(http.StatusBadRequest, "ask what-if questions on a main run")
	}
	var hasResults bool
	if err := s.store.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM metrics WHERE run_id=$1)`, run.ID).Scan(&hasResults); err != nil {
		return "", err
	}
	if !hasResults {
		return "", httpx.Errorf(http.StatusConflict, "the run must produce results (metrics.json) before what-if branches can start")
	}
	qid := "q_" + auth.RandomToken(6)
	if err := s.store.CreateWhatIfQuestion(ctx, run.ID, qid, question); err != nil {
		return "", err
	}
	if err := s.bus.Enqueue(ctx, map[string]any{"type": "whatif", "run_id": run.ID, "question_id": qid,
		"question": question, "user_id": userID}); err != nil {
		return "", err
	}
	s.event(ctx, run.ID, "researcher", "whatif_asked", "What if: "+question, "Asked via "+via,
		map[string]any{"question_id": qid})
	return qid, nil
}

// GET /runs/{id}/whatif
func (s *Service) ListWhatIf(w http.ResponseWriter, r *http.Request) error {
	return s.jsonView(w, r, s.store.WhatIfBranches)
}

// ---------- results views ----------

func (s *Service) jsonView(w http.ResponseWriter, r *http.Request, fn func(context.Context, int64) (json.RawMessage, error)) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	data, err := fn(r.Context(), run.ID)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
	return nil
}

// GET /runs/{id}/scorecard — Claim Scorecard; each "ours" value carries its proof card.
func (s *Service) Scorecard(w http.ResponseWriter, r *http.Request) error {
	return s.jsonView(w, r, s.store.Scorecard)
}

// GET /runs/{id}/settings — Missing Details Log (source: paper / official_code / assumption / compute_change).
func (s *Service) Settings(w http.ResponseWriter, r *http.Request) error {
	return s.jsonView(w, r, s.store.Settings)
}

// GET /runs/{id}/metrics
func (s *Service) Metrics(w http.ResponseWriter, r *http.Request) error {
	return s.jsonView(w, r, s.store.Metrics)
}

// GET /runs/{id}/map — Observer Agent's research map (nodes/edges for Excalidraw).
func (s *Service) Map(w http.ResponseWriter, r *http.Request) error {
	return s.jsonView(w, r, s.store.ResearchMap)
}

// GET /runs/{id}/gap — Gap Detective findings.
func (s *Service) Gap(w http.ResponseWriter, r *http.Request) error {
	return s.jsonView(w, r, s.store.GapAnalyses)
}

// GET /runs/{id}/research — papers with their Claims Lists, plus the Research Brief markdown.
func (s *Service) Research(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	papers, err := s.store.Papers(r.Context(), run.WorkspaceID)
	if err != nil {
		return err
	}
	brief, _ := os.ReadFile(filepath.Join(s.projectDir(run), "research", "brief.md"))
	out := map[string]any{"papers": papers, "brief_markdown": string(brief)}
	// The structured brief (methods, missing details, sources with their URLs, related papers) written by the agents.
	if raw, err := os.ReadFile(filepath.Join(s.projectDir(run), "research", "brief.json")); err == nil && json.Valid(raw) {
		out["brief"] = json.RawMessage(raw)
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

// GET /metrics/{id}/proof — proof card for any number on screen.
func (s *Service) MetricProof(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	data, err := s.store.MetricByID(r.Context(), id)
	if err != nil {
		return err
	}
	var m struct {
		RunID int64 `json:"run_id"`
	}
	_ = json.Unmarshal(data, &m)
	run, err := s.store.RunByID(r.Context(), m.RunID)
	if err != nil {
		return err
	}
	if _, err := workspace.Access(r.Context(), s.store, run.WorkspaceID, "viewer"); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
	return nil
}

func (s *Service) projectDir(run *store.Run) string {
	return filepath.Join(s.cfg.DataDir, filepath.FromSlash(sandbox.ProjectRel(run.WorkspaceID, run.ID)))
}

type fileEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// GET /runs/{id}/files — project files (code, configs, tests, results, logs).
func (s *Service) Files(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	root := s.projectDir(run)
	out := []fileEntry{}
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			switch strings.Split(rel, "/")[0] {
			case ".git", ".pydeps", ".cache", "data", "__pycache__", ".pytest_cache":
				return filepath.SkipDir
			}
			return nil
		}
		if info, err := d.Info(); err == nil {
			out = append(out, fileEntry{Path: rel, Size: info.Size()})
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

// GET /runs/{id}/file?path=src/train.py — one project file as text (max 2 MB).
func (s *Service) File(w http.ResponseWriter, r *http.Request) error {
	run, _, err := s.loadRun(r, "viewer")
	if err != nil {
		return err
	}
	rel := r.URL.Query().Get("path")
	if rel == "" || strings.HasPrefix(rel, ".git") {
		return httpx.Errorf(http.StatusBadRequest, "path is required")
	}
	p, err := workspace.DataPath(s.projectDir(run), rel)
	if err != nil {
		return httpx.ErrForbidden
	}
	info, err := os.Stat(p)
	if err != nil || info.IsDir() {
		return store.ErrNotFound
	}
	if info.Size() > 2<<20 {
		return httpx.Errorf(http.StatusRequestEntityTooLarge, "file is larger than 2 MB")
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	http.ServeFile(w, r, p)
	return nil
}

// GET /memory/search?q=&kind=&limit= — meaning-based search via the agent service,
// falling back to text search if it is unreachable.
func (s *Service) MemorySearch(w http.ResponseWriter, r *http.Request) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	kind := r.URL.Query().Get("kind")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	data, err := s.agents.MemorySearch(r.Context(), q, kind, limit)
	mode := "semantic"
	if err != nil {
		mode = "text"
		data, err = s.store.MemoryTextSearch(r.Context(), q, kind, limit)
		if err != nil {
			return err
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"mode": mode, "results": data})
	return nil
}

// GET /papers/{id}/pdf — the paper PDF for the viewer (uploaded or downloaded from arXiv).
func (s *Service) PaperPDF(w http.ResponseWriter, r *http.Request) error {
	id, err := httpx.IDParam(r, "id")
	if err != nil {
		return err
	}
	var wsID int64
	var pdfPath, title string
	if err := s.store.Pool.QueryRow(r.Context(), `SELECT workspace_id, pdf_path, title FROM papers WHERE id=$1`, id).
		Scan(&wsID, &pdfPath, &title); err != nil {
		return store.ErrNotFound
	}
	if _, err := workspace.Access(r.Context(), s.store, wsID, "viewer"); err != nil {
		return err
	}
	if pdfPath == "" {
		return httpx.Errorf(http.StatusNotFound, "no PDF is available for this paper yet")
	}
	w.Header().Set("Content-Type", "application/pdf")
	workspace.ServeDataFile(w, r, s.cfg.DataDir, pdfPath, title+".pdf")
	return nil
}
