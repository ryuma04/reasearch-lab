package mcp

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type Server struct {
	cfg     *config.Config
	store   *store.Store
	bus     *bus.Bus
	sandbox *sandbox.Service
	user    *store.User
}

func NewServer(cfg *config.Config, st *store.Store, b *bus.Bus, sbx *sandbox.Service, u *store.User) *Server {
	return &Server{
		cfg:     cfg,
		store:   st,
		bus:     b,
		sandbox: sbx,
		user:    u,
	}
}

func ok(v any) (*mcp.CallToolResult, Out, error) {
	data, _ := json.Marshal(v)
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: string(data)},
		},
	}, Out{Result: string(data)}, nil
}

// addTool registers a tool with a typed input schema on the MCP server.
func addTool[In any](s *mcp.Server, t *mcp.Tool, h mcp.ToolHandlerFor[In, Out]) {
	schema, err := jsonschema.For[In](nil)
	if err != nil {
		slog.Error("failed generating jsonschema for tool", "tool", t.Name, "err", err)
	} else {
		t.InputSchema = schema
	}
	mcp.AddTool(s, t, func(ctx context.Context, req *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		res, out, err := h(ctx, req, in)
		if err != nil {
			slog.Warn("mcp tool call error", "tool", t.Name, "err", err)
			return nil, Out{Result: err.Error()}, err
		}
		return res, out, nil
	})
	t.OutputSchema = nil
}

const serverInstructions = "Research Reproduction MCP Server provides tools to inspect papers, explore and edit code workspaces, " +
	"run experiments in isolated Docker sandboxes, debug with bounded self-healing repairs, compare metrics with paper claims, " +
	"query Lab Memory, and publish approved artifacts."

// BuildMCPServer creates a fully populated MCP server instance for the given user.
func (srv *Server) BuildMCPServer() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{
		Name:    "research-reproduction-lab",
		Version: "1.0.0",
	}, &mcp.ServerOptions{
		Instructions:               serverInstructions,
		KeepAlive:                  30 * time.Second,
		KeepAliveFailureThreshold: 3,
	})
	// Every tool call is checked against the caller's role in the workspace it touches (see authz.go).
	s.AddReceivingMiddleware(srv.authzMiddleware)

	// 0. Discovery: the caller's workspaces, papers and run ids
	addTool(s, &mcp.Tool{Name: "lab_list_workspaces", Description: "List the workspaces you can access with their papers and runs (run_id, status). Start here to find the run_id the other tools need."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in LabListWorkspacesIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleLabListWorkspaces(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "lab_start_run", Description: "Start the agent team (paper reading, planning, coding, Docker sandbox runs, tests) on a workspace that has a paper. Same as the Start run button in the app; returns the run_id and the app link to watch it live."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in LabStartRunIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleLabStartRun(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 1. Research Papers
	addTool(s, &mcp.Tool{Name: "paper_upload_or_link", Description: "Upload a local research paper PDF or link an arXiv paper (e.g. https://arxiv.org/abs/1706.03762) into a reproduction workspace."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PaperUploadIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePaperUpload(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "paper_get_content", Description: "Retrieve paper title, abstract, parsed markdown, and text for a run."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PaperContentIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePaperGetContent(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "paper_get_pages", Description: "Retrieve text for specific pages of the research paper."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PaperPagesIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePaperGetPages(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "paper_get_claims", Description: "Retrieve reported claims list and target metrics from the research paper."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PaperClaimsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePaperGetClaims(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "paper_get_citations", Description: "Retrieve citations, datasets, and source links associated with the paper."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PaperCitationsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePaperGetCitations(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 2. Workspace & Editor
	addTool(s, &mcp.Tool{Name: "workspace_list_files", Description: "List all code and configuration files in the project workspace."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in WorkspaceListFilesIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleWorkspaceListFiles(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "workspace_read_file", Description: "Read the UTF-8 text content of a source file in the project."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in WorkspaceReadFileIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleWorkspaceReadFile(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "workspace_write_file", Description: "Safely create or update an editable file (src/, configs/, tests/, requirements.txt)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in WorkspaceWriteFileIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleWorkspaceWriteFile(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "workspace_search_code", Description: "Search for strings or patterns across code files in the workspace."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in WorkspaceSearchCodeIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleWorkspaceSearchCode(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "workspace_validate_structure", Description: "Validate standard reproduction project layout (src, configs, tests, results, models)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in WorkspaceValidateStructureIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleWorkspaceValidateStructure(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "workspace_static_checks", Description: "Run static syntax and bracket/syntax integrity checks on code files."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in WorkspaceStaticChecksIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleWorkspaceStaticChecks(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "workspace_get_diff", Description: "Retrieve unified diff of workspace modifications since original baseline."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in WorkspaceGetDiffIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleWorkspaceGetDiff(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 3. Sandbox
	addTool(s, &mcp.Tool{Name: "sandbox_execute", Description: "Execute entrypoint Python script inside isolated Docker sandbox container."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in SandboxExecuteIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleSandboxExecute(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "sandbox_get_status", Description: "Inspect run status, exit code, duration, and error of a sandbox execution."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in SandboxGetStatusIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleSandboxGetStatus(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "sandbox_get_logs", Description: "Retrieve stdout and stderr logs for a sandbox execution with byte offset streaming."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in SandboxGetLogsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleSandboxGetLogs(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "sandbox_list_artifacts", Description: "List produced output artifacts in results/ and trained weights in models/."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in SandboxListArtifactsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleSandboxListArtifacts(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "sandbox_run_tests", Description: "Run pytest inside the sandbox and retrieve structured junit correctness/claim test results."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in SandboxRunTestsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleSandboxRunTests(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "sandbox_cancel", Description: "Cancel and terminate a running sandbox execution."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in SandboxCancelIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleSandboxCancel(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 4. Self-Healing Debugger
	addTool(s, &mcp.Tool{Name: "debugger_inspect_error", Description: "Inspect execution traceback, failing file/line, and error classification."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in DebuggerInspectErrorIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleDebuggerInspectError(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "debugger_propose_patch", Description: "Propose minimal fix patch consulting Lab Memory and deterministic error patterns."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in DebuggerProposePatchIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleDebuggerProposePatch(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "debugger_apply_and_rerun", Description: "Apply code patch, enforce maximum of 3 repair attempts, and re-run in fresh sandbox."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in DebuggerApplyAndRerunIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleDebuggerApplyAndRerun(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "debugger_get_heal_status", Description: "Retrieve history of self-healing repair sessions and attempt outcomes."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in DebuggerGetHealStatusIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleDebuggerGetHealStatus(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 5. Experiments & Metrics
	addTool(s, &mcp.Tool{Name: "experiment_get_config_and_history", Description: "Retrieve hyperparameter configurations and past execution history for run."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in ExperimentGetConfigAndHistoryIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleExperimentGetConfigAndHistory(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "experiment_launch", Description: "Launch a controlled experiment run with hyperparameter overrides."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in ExperimentLaunchIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleExperimentLaunch(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "experiment_compare_runs", Description: "Compare measured metrics and parameters between two runs."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in ExperimentCompareRunsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleExperimentCompareRuns(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "experiment_get_metrics", Description: "Retrieve measured reproduction metrics from results/metrics.json and database."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in ExperimentGetMetricsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleExperimentGetMetrics(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "experiment_compare_claims", Description: "Compare measured metrics against paper claims in the scorecard."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in ExperimentCompareClaimsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleExperimentCompareClaims(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "experiment_get_evidence", Description: "Retrieve cryptographic and log proof evidence verifying a measured metric."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in ExperimentGetEvidenceIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleExperimentGetEvidence(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 6. Lab Memory
	addTool(s, &mcp.Tool{Name: "memory_search", Description: "Search prior experiments, bug fixes, settings, and findings in Lab Memory."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in MemorySearchIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleMemorySearch(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "memory_get_record", Description: "Retrieve a specific Lab Memory record by ID."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in MemoryGetRecordIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleMemoryGetRecord(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "memory_store", Description: "Store a newly verified error fix, setting, or reproduction finding into Lab Memory."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in MemoryStoreIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleMemoryStore(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 7. Publishing
	addTool(s, &mcp.Tool{Name: "publish_validate_artifacts", Description: "Validate model artifact formats, weight files, and sizes before publishing."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PublishValidateArtifactsIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePublishValidateArtifacts(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "publish_generate_model_card", Description: "Generate Hugging Face model card README.md from recorded reproduction facts."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PublishGenerateModelCardIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePublishGenerateModelCard(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "publish_to_huggingface", Description: "Publish approved model artifact to Hugging Face (requires approved: true)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PublishToHuggingFaceIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePublishToHuggingFace(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "publish_to_github", Description: "Push approved code and reproduction results to GitHub (requires approved: true)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in PublishToGitHubIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handlePublishToGitHub(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	// 8. Task Management
	addTool(s, &mcp.Tool{Name: "task_get_status", Description: "Retrieve current status, step timeline, and results of an MCP assistant task."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in TaskGetStatusIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleTaskGetStatus(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "task_track_progress", Description: "Track live progress metrics, current step, and approval requirements for task."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in TaskTrackProgressIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleTaskTrackProgress(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "task_cancel", Description: "Cancel and stop a running MCP research task."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in TaskCancelIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleTaskCancel(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "task_resume", Description: "Resume an MCP task after approval or temporary pause."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in TaskResumeIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleTaskResume(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	addTool(s, &mcp.Tool{Name: "task_request_approval", Description: "Request human researcher confirmation for sensitive or destructive actions."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in TaskRequestApprovalIn) (*mcp.CallToolResult, Out, error) {
			res, err := srv.handleTaskRequestApproval(ctx, in)
			if err != nil {
				return nil, Out{}, err
			}
			return ok(res)
		})

	return s
}

// Handler returns the Streamable HTTP handler for the MCP endpoint (/mcp).
func Handler(cfg *config.Config, st *store.Store, b *bus.Bus, sbx *sandbox.Service) http.HandlerFunc {
	h := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		u, _ := r.Context().Value(mcpUserKey{}).(*store.User)
		srv := NewServer(cfg, st, b, sbx, u)
		return srv.BuildMCPServer()
	}, &mcp.StreamableHTTPOptions{SessionTimeout: 2 * time.Hour})

	var owners sync.Map // session ID -> user ID

	return func(w http.ResponseWriter, r *http.Request) {
		u, _ := r.Context().Value(mcpUserKey{}).(*store.User)
		if u == nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		sid := r.Header.Get("Mcp-Session-Id")
		if sid != "" {
			if owner, ok := owners.Load(sid); ok && owner != u.ID {
				http.Error(w, `{"error":"forbidden: session belongs to another user"}`, http.StatusForbidden)
				return
			}
		}

		h.ServeHTTP(w, r)

		if sid == "" {
			if newSID := w.Header().Get("Mcp-Session-Id"); newSID != "" {
				owners.Store(newSID, u.ID)
			}
		} else if r.Method == http.MethodDelete {
			owners.Delete(sid)
		}
	}
}

type mcpUserKey struct{}

func WithUser(ctx context.Context, u *store.User) context.Context {
	return context.WithValue(ctx, mcpUserKey{}, u)
}

func mustJSON(v any) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}
