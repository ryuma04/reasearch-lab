// Package voice handles voice commands from the mobile web app: Groq Whisper turns speech into
// text, then the Team Manager (agent service /intent) understands it. The app shows the intent
// and asks for a one-tap confirmation before calling the normal API for anything that changes work.
package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/ryuma04/tapu-sena/services/api/internal/agentsclient"
	"github.com/ryuma04/tapu-sena/services/api/internal/auth"
	"github.com/ryuma04/tapu-sena/services/api/internal/config"
	"github.com/ryuma04/tapu-sena/services/api/internal/httpx"
	"github.com/ryuma04/tapu-sena/services/api/internal/store"
)

type Service struct {
	cfg    *config.Config
	store  *store.Store
	agents *agentsclient.Client
	http   *http.Client
}

func New(cfg *config.Config, st *store.Store, ac *agentsclient.Client) *Service {
	return &Service{cfg: cfg, store: st, agents: ac, http: &http.Client{Timeout: 60 * time.Second}}
}

// POST /voice/command (multipart "audio") -> {"text": "...", "intent": {...}}
func (s *Service) Command(w http.ResponseWriter, r *http.Request) error {
	if len(s.cfg.GroqAPIKeys) == 0 {
		return httpx.Errorf(http.StatusServiceUnavailable, "voice is not configured (GROQ_API_KEY missing)")
	}
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
	f, fh, err := r.FormFile("audio")
	if err != nil {
		return httpx.Errorf(http.StatusBadRequest, "send the recording in the 'audio' field")
	}
	defer f.Close()
	audio, err := io.ReadAll(f)
	if err != nil {
		return err
	}
	text, err := s.transcribeAnyKey(r.Context(), fh.Filename, audio)
	if err != nil {
		return httpx.Errorf(http.StatusBadGateway, "transcription failed: "+err.Error())
	}
	return s.understand(w, r, text)
}

// POST /voice/text {"text": "..."} — the same command understanding for typed input.
func (s *Service) Text(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Text string `json:"text"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if strings.TrimSpace(body.Text) == "" {
		return httpx.Errorf(http.StatusBadRequest, "text is required")
	}
	return s.understand(w, r, body.Text)
}

func (s *Service) understand(w http.ResponseWriter, r *http.Request, text string) error {
	ctx := r.Context()
	list, err := s.store.ActiveRunsForUser(ctx, auth.UserID(ctx))
	if err != nil {
		return err
	}
	rcs := make([]agentsclient.RunContext, 0, len(list))
	for _, run := range list {
		rc := agentsclient.RunContext{ID: run.ID, WorkspaceID: run.WorkspaceID, Status: run.Status, Stage: run.Stage}
		if ws, err := s.store.WorkspaceByID(ctx, run.WorkspaceID); err == nil {
			rc.Title = ws.Title
		}
		if cps, err := s.store.Checkpoints(ctx, run.ID); err == nil {
			for _, c := range cps {
				if c.Status == "pending" {
					rc.Pending = c.Name
				}
			}
		}
		rcs = append(rcs, rc)
	}
	intent, err := s.agents.Intent(ctx, text, rcs)
	if err != nil {
		return httpx.Errorf(http.StatusBadGateway, "agent service unavailable")
	}
	if intent.Action == "status" && intent.RunID != 0 {
		if summary, err := s.agents.Summary(ctx, intent.RunID); err == nil {
			intent.Reply = summary
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"text": text, "intent": intent})
	return nil
}

// transcribeAnyKey tries each Groq key in turn: when one hits its limit (HTTP 429) the next is used.
func (s *Service) transcribeAnyKey(ctx context.Context, filename string, audio []byte) (string, error) {
	var lastErr error
	for i, key := range s.cfg.GroqAPIKeys {
		text, err := Transcribe(ctx, s.http, key, s.cfg.WhisperModel, filename, audio)
		if err == nil {
			return text, nil
		}
		lastErr = err
		if !errors.Is(err, ErrRateLimited) {
			return "", err
		}
		slog.Warn("whisper key rate limited, switching key", "key_index", i)
	}
	return "", lastErr
}

// ErrRateLimited means the key reached its limit; another key may still work.
var ErrRateLimited = errors.New("rate limit reached for this API key")

// Transcribe sends audio to Groq Whisper (OpenAI-compatible endpoint).
func Transcribe(ctx context.Context, client *http.Client, apiKey, model, filename string, audio []byte) (string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("model", model)
	_ = mw.WriteField("response_format", "json")
	fw, _ := mw.CreateFormFile("file", filename)
	_, _ = fw.Write(audio)
	_ = mw.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.groq.com/openai/v1/audio/transcriptions", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return "", ErrRateLimited
	}
	var out struct {
		Text  string `json:"text"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.Error != nil {
		return "", fmt.Errorf("%s", out.Error.Message)
	}
	return strings.TrimSpace(out.Text), nil
}
