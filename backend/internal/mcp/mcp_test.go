package mcp

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

func TestAvailableToolsDiscovery(t *testing.T) {
	cfg := &config.Config{DataDir: t.TempDir()}
	orch := NewOrchestrator(cfg, nil, nil, nil)
	tools := orch.availableTools()

	if len(tools) < 20 {
		t.Fatalf("expected at least 20 tools, got %d", len(tools))
	}

	requiredToolNames := []string{
		"paper_get_content",
		"paper_get_claims",
		"workspace_list_files",
		"workspace_read_file",
		"workspace_write_file",
		"workspace_search_code",
		"workspace_validate_structure",
		"workspace_static_checks",
		"workspace_get_diff",
		"sandbox_execute",
		"sandbox_get_status",
		"sandbox_get_logs",
		"sandbox_list_artifacts",
		"sandbox_run_tests",
		"sandbox_cancel",
		"debugger_inspect_error",
		"debugger_propose_patch",
		"debugger_apply_and_rerun",
		"debugger_get_heal_status",
		"experiment_get_config_and_history",
		"experiment_launch",
		"experiment_compare_runs",
		"experiment_get_metrics",
		"experiment_compare_claims",
		"experiment_get_evidence",
		"memory_search",
		"memory_store",
		"publish_validate_artifacts",
		"publish_generate_model_card",
		"publish_to_huggingface",
		"publish_to_github",
	}

	toolMap := make(map[string]bool)
	for _, tool := range tools {
		toolMap[tool.Name] = true
		if tool.Description == "" {
			t.Errorf("tool %s missing description", tool.Name)
		}
		if tool.InputSchema == nil {
			t.Errorf("tool %s missing input schema", tool.Name)
		}
	}

	for _, name := range requiredToolNames {
		if !toolMap[name] {
			t.Errorf("missing required tool: %s", name)
		}
	}
}

func TestWorkspaceFileSafetyAndDiff(t *testing.T) {
	tempDir := t.TempDir()
	cfg := &config.Config{DataDir: tempDir}
	u := &store.User{ID: 1, Name: "Tester", Email: "test@example.com"}
	srv := NewServer(cfg, nil, nil, nil, u)

	runID := int64(99)
	projDir := srv.projectDir(runID)
	if err := os.MkdirAll(filepath.Join(projDir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}

	// 1. Path traversal attempt should fail
	_, err := srv.handleWorkspaceWriteFile(context.Background(), WorkspaceWriteFileIn{
		RunID:   runID,
		Path:    "../escaped.py",
		Content: "print('bad')",
	})
	if err == nil {
		t.Fatal("expected error on path traversal attempt, got nil")
	}

	// 2. Writing outside allowed folders should fail
	_, err = srv.handleWorkspaceWriteFile(context.Background(), WorkspaceWriteFileIn{
		RunID:   runID,
		Path:    "random/file.py",
		Content: "print('bad')",
	})
	if err == nil {
		t.Fatal("expected error on disallowed folder write, got nil")
	}

	// 3. Valid write into src/train.py
	validContent := "import torch\nprint('hello world')\n"
	writeRes, err := srv.handleWorkspaceWriteFile(context.Background(), WorkspaceWriteFileIn{
		RunID:   runID,
		Path:    "src/train.py",
		Content: validContent,
	})
	if err != nil {
		t.Fatalf("unexpected write error: %v", err)
	}
	resMap, ok := writeRes.(map[string]any)
	if !ok || resMap["status"] != "saved" {
		t.Fatalf("expected status saved, got %v", writeRes)
	}

	// 4. Read back the file
	readRes, err := srv.handleWorkspaceReadFile(context.Background(), WorkspaceReadFileIn{
		RunID: runID,
		Path:  "src/train.py",
	})
	if err != nil {
		t.Fatalf("unexpected read error: %v", err)
	}
	readMap, _ := readRes.(map[string]any)
	if readMap["content"] != validContent {
		t.Fatalf("content mismatch: got %q, expected %q", readMap["content"], validContent)
	}

	// 5. Update file to test diff creation
	updatedContent := "import torch\nprint('hello updated world')\n"
	_, err = srv.handleWorkspaceWriteFile(context.Background(), WorkspaceWriteFileIn{
		RunID:   runID,
		Path:    "src/train.py",
		Content: updatedContent,
	})
	if err != nil {
		t.Fatalf("unexpected write error on update: %v", err)
	}

	diffRes, err := srv.handleWorkspaceGetDiff(context.Background(), WorkspaceGetDiffIn{
		RunID: runID,
		Path:  "src/train.py",
	})
	if err != nil {
		t.Fatalf("unexpected diff error: %v", err)
	}
	diffMap, _ := diffRes.(map[string]any)
	if diffMap["has_changes"] != true {
		t.Fatalf("expected has_changes=true in diff, got %v", diffRes)
	}

	// 6. Search code
	searchRes, err := srv.handleWorkspaceSearchCode(context.Background(), WorkspaceSearchCodeIn{
		RunID: runID,
		Query: "updated",
	})
	if err != nil {
		t.Fatalf("unexpected search error: %v", err)
	}
	searchMap, _ := searchRes.(map[string]any)
	if searchMap["matches_count"].(int) != 1 {
		t.Fatalf("expected 1 search match, got %v", searchMap["matches_count"])
	}

	// 7. Validate structure
	structRes, err := srv.handleWorkspaceValidateStructure(context.Background(), WorkspaceValidateStructureIn{
		RunID: runID,
	})
	if err != nil {
		t.Fatalf("unexpected validate structure error: %v", err)
	}
	structMap, _ := structRes.(map[string]any)
	checks, _ := structMap["checks"].(map[string]bool)
	if !checks["src_directory"] || !checks["entrypoint_train"] {
		t.Fatalf("expected src_directory and entrypoint_train to be true, got %v", checks)
	}
}

func TestPublishingGating(t *testing.T) {
	tempDir := t.TempDir()
	cfg := &config.Config{DataDir: tempDir}
	u := &store.User{ID: 1, Name: "Tester", Email: "test@example.com"}
	srv := NewServer(cfg, nil, nil, nil, u)

	// Publishing to Hugging Face without approved flag must return requires_approval
	hfRes, err := srv.handlePublishToHuggingFace(context.Background(), PublishToHuggingFaceIn{
		RunID:    101,
		RepoName: "cifar-test",
		Approved: false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	hfMap, _ := hfRes.(map[string]any)
	if hfMap["requires_approval"] != true || hfMap["status"] != "waiting_approval" {
		t.Fatalf("expected requires_approval=true, got %v", hfRes)
	}

	// Publishing to GitHub without approved flag must return requires_approval
	ghRes, err := srv.handlePublishToGitHub(context.Background(), PublishToGitHubIn{
		RunID:    101,
		RepoName: "repo-test",
		Approved: false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ghMap, _ := ghRes.(map[string]any)
	if ghMap["requires_approval"] != true || ghMap["status"] != "waiting_approval" {
		t.Fatalf("expected requires_approval=true, got %v", ghRes)
	}
}

func TestBuildMCPServerTools(t *testing.T) {
	tempDir := t.TempDir()
	cfg := &config.Config{DataDir: tempDir}
	u := &store.User{ID: 1, Name: "Tester", Email: "test@example.com"}
	srv := NewServer(cfg, nil, nil, nil, u)

	mcpServer := srv.BuildMCPServer()
	if mcpServer == nil {
		t.Fatal("expected non-nil MCP server")
	}
}

func TestDeterministicOrchestrator(t *testing.T) {
	cfg := &config.Config{DataDir: t.TempDir()}
	orch := NewOrchestrator(cfg, nil, nil, nil)
	tools := orch.availableTools()

	// Initial prompt with "check paper claims"
	msgs := []map[string]any{
		{"role": "user", "content": "Please check the paper claims for this run."},
	}
	res, err := orch.callDeterministic(msgs, tools)
	if err != nil {
		t.Fatalf("callDeterministic failed: %v", err)
	}
	if len(res.ToolCalls) == 0 || res.ToolCalls[0].Name != "paper_get_claims" {
		t.Fatalf("expected paper_get_claims tool call, got %v", res)
	}

	// Following tool response, should conclude
	msgs = append(msgs, map[string]any{
		"role":    "tool",
		"content": `{"claims":[{"id":1,"claim_text":"Accuracy 94.2%"}]}`,
	})
	res2, err := orch.callDeterministic(msgs, tools)
	if err != nil {
		t.Fatalf("callDeterministic 2 failed: %v", err)
	}
	if len(res2.ToolCalls) != 0 || res2.Text == "" {
		t.Fatalf("expected conclusion text, got %v", res2)
	}
}
