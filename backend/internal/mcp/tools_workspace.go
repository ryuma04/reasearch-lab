package mcp

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type WorkspaceListFilesIn struct {
	RunID int64 `json:"run_id"`
}

type WorkspaceReadFileIn struct {
	RunID int64  `json:"run_id"`
	Path  string `json:"path" jsonschema:"relative path e.g. src/train.py"`
}

type WorkspaceWriteFileIn struct {
	RunID   int64  `json:"run_id"`
	Path    string `json:"path" jsonschema:"relative path e.g. src/train.py"`
	Content string `json:"content" jsonschema:"UTF-8 file text"`
}

type WorkspaceSearchCodeIn struct {
	RunID      int64  `json:"run_id"`
	Query      string `json:"query" jsonschema:"text string to search for"`
	PathPrefix string `json:"path_prefix,omitempty" jsonschema:"optional filter e.g. src/"`
}

type WorkspaceValidateStructureIn struct {
	RunID int64 `json:"run_id"`
}

type WorkspaceStaticChecksIn struct {
	RunID int64  `json:"run_id"`
	Path  string `json:"path,omitempty" jsonschema:"optional file path e.g. src/train.py; checks all if omitted"`
}

type WorkspaceGetDiffIn struct {
	RunID int64  `json:"run_id"`
	Path  string `json:"path,omitempty" jsonschema:"optional file path; diffs all modified files if omitted"`
}

func (s *Server) projectDir(runID int64) string {
	return filepath.Join(s.cfg.DataDir, fmt.Sprintf("runs/%d/project", runID))
}

func (s *Server) checkRun(ctx context.Context, runID int64) (*store.Run, error) {
	if s.store == nil {
		return &store.Run{ID: runID}, nil
	}
	return s.store.RunByID(ctx, runID)
}

func (s *Server) handleWorkspaceListFiles(ctx context.Context, in WorkspaceListFilesIn) (any, error) {
	_, err := s.checkRun(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	root := s.projectDir(in.RunID)
	if _, err := os.Stat(root); os.IsNotExist(err) {
		return map[string]any{"run_id": in.RunID, "files": []any{}, "message": "Project directory not created yet"}, nil
	}

	type FileEntry struct {
		Path     string `json:"path"`
		Size     int64  `json:"size"`
		Modified string `json:"modified"`
		Folder   string `json:"folder"`
	}

	files := make([]FileEntry, 0)
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		relFwd := filepath.ToSlash(rel)
		// Ignore hidden files and __pycache__
		if strings.Contains(relFwd, "/.") || strings.HasPrefix(relFwd, ".") || strings.Contains(relFwd, "__pycache__") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		top, _, _ := strings.Cut(relFwd, "/")
		files = append(files, FileEntry{
			Path:     relFwd,
			Size:     info.Size(),
			Modified: info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
			Folder:   top,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("scanning project files: %w", err)
	}

	return map[string]any{
		"run_id":      in.RunID,
		"files":       files,
		"total_files": len(files),
	}, nil
}

func (s *Server) handleWorkspaceReadFile(ctx context.Context, in WorkspaceReadFileIn) (any, error) {
	_, err := s.checkRun(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	cleanRel, err := sandbox.CleanRel(in.Path)
	if err != nil {
		return nil, fmt.Errorf("invalid path: %w", err)
	}

	fullPath := filepath.Join(s.projectDir(in.RunID), filepath.FromSlash(cleanRel))
	info, err := os.Stat(fullPath)
	if err != nil {
		return nil, fmt.Errorf("file not found: %s", in.Path)
	}
	if info.Size() > sandbox.MaxSourceBytes {
		return nil, fmt.Errorf("file is larger than maximum allowed size (%d bytes)", sandbox.MaxSourceBytes)
	}

	data, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, fmt.Errorf("reading file: %w", err)
	}
	if !utf8.Valid(data) {
		return nil, errors.New("file is not valid UTF-8 text")
	}

	return map[string]any{
		"run_id":  in.RunID,
		"path":    cleanRel,
		"content": string(data),
		"size":    info.Size(),
	}, nil
}

func (s *Server) handleWorkspaceWriteFile(ctx context.Context, in WorkspaceWriteFileIn) (any, error) {
	// Restrict to editable paths (src/, configs/, tests/, requirements.txt) FIRST
	cleanPath, err := sandbox.EditablePath(in.Path)
	if err != nil {
		return nil, fmt.Errorf("cannot write to path: %w", err)
	}

	run, err := s.checkRun(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	if len(in.Content) > sandbox.MaxSourceBytes {
		return nil, fmt.Errorf("content exceeds maximum file size (%d bytes)", sandbox.MaxSourceBytes)
	}
	if !utf8.ValidString(in.Content) || strings.Contains(in.Content, "\x00") {
		return nil, errors.New("content must be valid UTF-8 text without NUL bytes")
	}

	projectDir := s.projectDir(in.RunID)
	target := filepath.Join(projectDir, filepath.FromSlash(cleanPath))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return nil, fmt.Errorf("creating directory: %w", err)
	}

	// Backup original file to .baseline if first time modifying
	baselineTarget := filepath.Join(projectDir, ".baseline", filepath.FromSlash(cleanPath))
	if _, err := os.Stat(target); err == nil {
		if _, err := os.Stat(baselineTarget); os.IsNotExist(err) {
			_ = os.MkdirAll(filepath.Dir(baselineTarget), 0o755)
			if originalBytes, err := os.ReadFile(target); err == nil {
				_ = os.WriteFile(baselineTarget, originalBytes, 0o644)
			}
		}
	}

	if err := os.WriteFile(target, []byte(in.Content), 0o644); err != nil {
		return nil, fmt.Errorf("saving file: %w", err)
	}

	// Emit event to Redis bus for real-time live editor update if bus available
	if s.bus != nil {
		s.bus.Emit(ctx, store.Event{
			RunID:   run.ID,
			Agent:   "coding.writer",
			Type:    "file_saved",
			Message: fmt.Sprintf("Assistant updated %s", cleanPath),
			Why:     "MCP tool workspace_write_file",
			Links:   mustJSON(map[string]any{"path": cleanPath, "size": len(in.Content)}),
		})
	}

	return map[string]any{
		"run_id":  run.ID,
		"path":    cleanPath,
		"size":    len(in.Content),
		"status":  "saved",
		"message": fmt.Sprintf("File %s saved successfully", cleanPath),
	}, nil
}

func (s *Server) handleWorkspaceSearchCode(ctx context.Context, in WorkspaceSearchCodeIn) (any, error) {
	_, err := s.checkRun(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	q := strings.TrimSpace(in.Query)
	if q == "" {
		return nil, errors.New("query cannot be empty")
	}

	root := s.projectDir(in.RunID)
	type SearchMatch struct {
		Path    string `json:"path"`
		Line    int    `json:"line"`
		Content string `json:"content"`
	}

	matches := make([]SearchMatch, 0)
	maxMatches := 50

	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || len(matches) >= maxMatches {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		relFwd := filepath.ToSlash(rel)
		if in.PathPrefix != "" && !strings.HasPrefix(relFwd, in.PathPrefix) {
			return nil
		}
		if !strings.HasSuffix(relFwd, ".py") && !strings.HasSuffix(relFwd, ".json") && !strings.HasSuffix(relFwd, ".yaml") {
			return nil
		}

		data, err := os.ReadFile(p)
		if err != nil || !utf8.Valid(data) {
			return nil
		}

		lines := strings.Split(string(data), "\n")
		for idx, line := range lines {
			if strings.Contains(strings.ToLower(line), strings.ToLower(q)) {
				matches = append(matches, SearchMatch{
					Path:    relFwd,
					Line:    idx + 1,
					Content: strings.TrimSpace(line),
				})
				if len(matches) >= maxMatches {
					break
				}
			}
		}
		return nil
	})

	return map[string]any{
		"run_id":        in.RunID,
		"query":         q,
		"matches":       matches,
		"matches_count": len(matches),
	}, nil
}

func (s *Server) handleWorkspaceValidateStructure(ctx context.Context, in WorkspaceValidateStructureIn) (any, error) {
	_, err := s.checkRun(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	root := s.projectDir(in.RunID)
	checks := map[string]bool{
		"src_directory":     dirExists(filepath.Join(root, "src")),
		"configs_directory": dirExists(filepath.Join(root, "configs")),
		"tests_directory":   dirExists(filepath.Join(root, "tests")),
		"results_directory": dirExists(filepath.Join(root, "results")),
		"models_directory":  dirExists(filepath.Join(root, "models")),
		"entrypoint_train":  fileExists(filepath.Join(root, "src", "train.py")),
		"requirements_file": fileExists(filepath.Join(root, "requirements.txt")),
	}

	valid := checks["src_directory"] && checks["entrypoint_train"]
	issues := make([]string, 0)
	if !checks["src_directory"] {
		issues = append(issues, "Missing src/ directory")
	}
	if !checks["entrypoint_train"] {
		issues = append(issues, "Missing standard entrypoint src/train.py")
	}
	if !checks["tests_directory"] {
		issues = append(issues, "Missing tests/ directory for verification")
	}

	return map[string]any{
		"run_id": in.RunID,
		"valid":  valid,
		"checks": checks,
		"issues": issues,
	}, nil
}

func (s *Server) handleWorkspaceStaticChecks(ctx context.Context, in WorkspaceStaticChecksIn) (any, error) {
	_, err := s.checkRun(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	root := s.projectDir(in.RunID)
	var filesToCheck []string

	if in.Path != "" {
		clean, err := sandbox.CleanRel(in.Path)
		if err != nil {
			return nil, err
		}
		filesToCheck = append(filesToCheck, filepath.Join(root, filepath.FromSlash(clean)))
	} else {
		_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() && strings.HasSuffix(p, ".py") {
				filesToCheck = append(filesToCheck, p)
			}
			return nil
		})
	}

	type LintError struct {
		File    string `json:"file"`
		Line    int    `json:"line"`
		Message string `json:"message"`
	}

	lintErrors := make([]LintError, 0)
	for _, f := range filesToCheck {
		rel, _ := filepath.Rel(root, f)
		data, err := os.ReadFile(f)
		if err != nil {
			lintErrors = append(lintErrors, LintError{File: filepath.ToSlash(rel), Message: "Could not read file"})
			continue
		}
		content := string(data)
		// Check basic bracket balance and indentation anomalies
		lines := strings.Split(content, "\n")
		parenCount, braceCount, bracketCount := 0, 0, 0
		for i, line := range lines {
			parenCount += strings.Count(line, "(") - strings.Count(line, ")")
			braceCount += strings.Count(line, "{") - strings.Count(line, "}")
			bracketCount += strings.Count(line, "[") - strings.Count(line, "]")
			if parenCount < 0 || braceCount < 0 || bracketCount < 0 {
				lintErrors = append(lintErrors, LintError{
					File:    filepath.ToSlash(rel),
					Line:    i + 1,
					Message: "Mismatched closing bracket/parenthesis",
				})
				break
			}
		}
		if parenCount > 0 || braceCount > 0 || bracketCount > 0 {
			lintErrors = append(lintErrors, LintError{
				File:    filepath.ToSlash(rel),
				Line:    len(lines),
				Message: "Unclosed bracket or parenthesis in file",
			})
		}
	}

	return map[string]any{
		"run_id":        in.RunID,
		"passed":        len(lintErrors) == 0,
		"errors":        lintErrors,
		"files_checked": len(filesToCheck),
	}, nil
}

func (s *Server) handleWorkspaceGetDiff(ctx context.Context, in WorkspaceGetDiffIn) (any, error) {
	_, err := s.checkRun(ctx, in.RunID)
	if err != nil {
		return nil, fmt.Errorf("run %d not found: %w", in.RunID, err)
	}

	root := s.projectDir(in.RunID)
	baselineRoot := filepath.Join(root, ".baseline")

	type DiffItem struct {
		Path string `json:"path"`
		Diff string `json:"diff"`
	}

	diffs := make([]DiffItem, 0)
	_ = filepath.WalkDir(baselineRoot, func(bp string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(baselineRoot, bp)
		if err != nil {
			return nil
		}
		relFwd := filepath.ToSlash(rel)
		if in.Path != "" && relFwd != in.Path {
			return nil
		}
		currentPath := filepath.Join(root, filepath.FromSlash(relFwd))
		oldBytes, _ := os.ReadFile(bp)
		newBytes, _ := os.ReadFile(currentPath)

		if string(oldBytes) != string(newBytes) {
			diffs = append(diffs, DiffItem{
				Path: relFwd,
				Diff: simpleUnifiedDiff(relFwd, string(oldBytes), string(newBytes)),
			})
		}
		return nil
	})

	return map[string]any{
		"run_id":      in.RunID,
		"has_changes": len(diffs) > 0,
		"diffs":       diffs,
	}, nil
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

func simpleUnifiedDiff(name, oldText, newText string) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("--- a/%s\n+++ b/%s\n", name, name))
	oldLines := strings.Split(oldText, "\n")
	newLines := strings.Split(newText, "\n")

	sb.WriteString(fmt.Sprintf("@@ -1,%d +1,%d @@\n", len(oldLines), len(newLines)))
	// Simple diff representation
	max := len(oldLines)
	if len(newLines) > max {
		max = len(newLines)
	}
	for i := 0; i < max; i++ {
		if i < len(oldLines) && i < len(newLines) {
			if oldLines[i] == newLines[i] {
				sb.WriteString(" " + oldLines[i] + "\n")
			} else {
				sb.WriteString("-" + oldLines[i] + "\n")
				sb.WriteString("+" + newLines[i] + "\n")
			}
		} else if i < len(oldLines) {
			sb.WriteString("-" + oldLines[i] + "\n")
		} else if i < len(newLines) {
			sb.WriteString("+" + newLines[i] + "\n")
		}
	}
	return sb.String()
}
