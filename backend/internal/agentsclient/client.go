// Package agentsclient calls the Python agent service (FastAPI) synchronously.
// Long work (runs, what-ifs) goes through the Redis job queue instead; this client is for
// quick request/response calls: health, Lab Memory search and command understanding.
package agentsclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	Token   string
	http    *http.Client
}

func New(baseURL, token string) *Client {
	return &Client{BaseURL: baseURL, Token: token, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("X-Internal-Token", c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("agents service %s %s: %d %s", method, path, resp.StatusCode, string(data))
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// Download fetches a file from the agent service (report exports). Returns body, content type and file name.
func (c *Client) Download(ctx context.Context, path string) ([]byte, string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return nil, "", "", err
	}
	req.Header.Set("X-Internal-Token", c.Token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 50<<20))
	if resp.StatusCode >= 300 {
		return nil, "", "", fmt.Errorf("agents service GET %s: %d %s", path, resp.StatusCode, string(data))
	}
	name := ""
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if _, after, ok := strings.Cut(cd, `filename="`); ok {
			name, _, _ = strings.Cut(after, `"`)
		}
	}
	return data, resp.Header.Get("Content-Type"), name, nil
}

func (c *Client) Health(ctx context.Context) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var out map[string]any
	return out, c.do(ctx, http.MethodGet, "/health", nil, &out)
}

func (c *Client) MemorySearch(ctx context.Context, q, kind string, limit int) (json.RawMessage, error) {
	v := url.Values{}
	v.Set("q", q)
	v.Set("kind", kind)
	v.Set("limit", fmt.Sprint(limit))
	var out json.RawMessage
	return out, c.do(ctx, http.MethodGet, "/memory/search?"+v.Encode(), nil, &out)
}

type RunContext struct {
	ID          int64  `json:"id"`
	WorkspaceID int64  `json:"workspace_id"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	Stage       string `json:"stage"`
	Pending     string `json:"pending_checkpoint,omitempty"`
}

type Intent struct {
	Action       string `json:"action"` // status | approve | reject | edit | whatif | pause | resume | stop | push | help | unknown
	RunID        int64  `json:"run_id"`
	Checkpoint   string `json:"checkpoint"`
	Question     string `json:"question"`
	Instruction  string `json:"instruction"`
	Reply        string `json:"reply"`
	NeedsConfirm bool   `json:"needs_confirm"`
}

// Intent asks the agent service to understand a researcher's command (typed or transcribed voice).
func (c *Client) Intent(ctx context.Context, text string, runs []RunContext) (*Intent, error) {
	var out Intent
	err := c.do(ctx, http.MethodPost, "/intent", map[string]any{"text": text, "runs": runs}, &out)
	return &out, err
}

// Summary asks for a short plain-language status summary of a run (numbers come from the DB).
func (c *Client) Summary(ctx context.Context, runID int64) (string, error) {
	var out struct {
		Text string `json:"text"`
	}
	err := c.do(ctx, http.MethodGet, fmt.Sprintf("/runs/%d/summary", runID), nil, &out)
	return out.Text, err
}
