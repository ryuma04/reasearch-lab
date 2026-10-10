package ghapi

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// File is one file to commit. Content is raw bytes (sent base64-encoded).
type File struct {
	Path    string `json:"path"`
	Content []byte `json:"-"`
}

type CommitSpec struct {
	Branch     string `json:"branch"`
	FromBranch string `json:"from_branch,omitempty"` // create Branch from this branch's head if missing
	Message    string `json:"message"`
	Files      []File `json:"files"`
}

type CommitResult struct {
	Branch string `json:"branch"`
	SHA    string `json:"sha"`
	URL    string `json:"url"`
	Msg    string `json:"message"`
}

func (c *Client) refSHA(ctx context.Context, repo, branch string) (string, error) {
	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	err := c.do(ctx, http.MethodGet, "/repos/"+repo+"/git/ref/heads/"+url.PathEscape(branch), nil, &ref)
	return ref.Object.SHA, err
}

// ensureInitialized makes sure an empty repository has a first commit (the git data API
// cannot create blobs in a repository with no commits).
func (c *Client) ensureInitialized(ctx context.Context, repo, branch string) error {
	if _, err := c.refSHA(ctx, repo, branch); err == nil {
		return nil
	}
	return c.do(ctx, http.MethodPut, "/repos/"+repo+"/contents/.gitkeep", map[string]any{
		"message": "Initialize repository", "content": "", "branch": branch,
	}, nil)
}

// PushCommits creates one commit per spec using the git data API (blobs -> tree -> commit -> ref).
func (c *Client) PushCommits(ctx context.Context, repo, baseBranch string, commits []CommitSpec) ([]CommitResult, error) {
	if err := c.ensureInitialized(ctx, repo, baseBranch); err != nil {
		return nil, fmt.Errorf("initialize repository: %w", err)
	}
	var out []CommitResult
	for _, spec := range commits {
		branch := spec.Branch
		if branch == "" {
			branch = baseBranch
		}
		head, err := c.refSHA(ctx, repo, branch)
		created := false
		if err != nil {
			var ae *APIError
			if !errors.As(err, &ae) || ae.Status != http.StatusNotFound {
				return out, err
			}
			from := spec.FromBranch
			if from == "" {
				from = baseBranch
			}
			if head, err = c.refSHA(ctx, repo, from); err != nil {
				return out, fmt.Errorf("base branch %s: %w", from, err)
			}
			created = true
		}
		var parent struct {
			Tree struct {
				SHA string `json:"sha"`
			} `json:"tree"`
		}
		if err := c.do(ctx, http.MethodGet, "/repos/"+repo+"/git/commits/"+head, nil, &parent); err != nil {
			return out, err
		}
		entries := make([]map[string]any, 0, len(spec.Files))
		for _, f := range spec.Files {
			var blob struct {
				SHA string `json:"sha"`
			}
			if err := c.do(ctx, http.MethodPost, "/repos/"+repo+"/git/blobs", map[string]any{
				"content": base64.StdEncoding.EncodeToString(f.Content), "encoding": "base64",
			}, &blob); err != nil {
				return out, fmt.Errorf("blob %s: %w", f.Path, err)
			}
			entries = append(entries, map[string]any{"path": strings.TrimPrefix(f.Path, "/"), "mode": "100644", "type": "blob", "sha": blob.SHA})
		}
		var tree struct {
			SHA string `json:"sha"`
		}
		if err := c.do(ctx, http.MethodPost, "/repos/"+repo+"/git/trees", map[string]any{
			"base_tree": parent.Tree.SHA, "tree": entries,
		}, &tree); err != nil {
			return out, err
		}
		var commit struct {
			SHA     string `json:"sha"`
			HTMLURL string `json:"html_url"`
		}
		if err := c.do(ctx, http.MethodPost, "/repos/"+repo+"/git/commits", map[string]any{
			"message": spec.Message, "tree": tree.SHA, "parents": []string{head},
		}, &commit); err != nil {
			return out, err
		}
		if created {
			err = c.do(ctx, http.MethodPost, "/repos/"+repo+"/git/refs", map[string]any{
				"ref": "refs/heads/" + branch, "sha": commit.SHA}, nil)
		} else {
			err = c.do(ctx, http.MethodPatch, "/repos/"+repo+"/git/refs/heads/"+url.PathEscape(branch), map[string]any{
				"sha": commit.SHA, "force": false}, nil)
		}
		if err != nil {
			return out, err
		}
		out = append(out, CommitResult{Branch: branch, SHA: commit.SHA, Msg: spec.Message,
			URL: "https://github.com/" + repo + "/commit/" + commit.SHA})
	}
	return out, nil
}
