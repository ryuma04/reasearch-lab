// Package telegram is the mobile control bot: notifications, one-tap approvals and voice
// commands (Groq Whisper -> Team Manager intent -> [Yes]/[No] confirmation for changes).
// Without TELEGRAM_BOT_TOKEN every outgoing message is only logged.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ryuma04/tapu-sena/backend/internal/agentsclient"
	"github.com/ryuma04/tapu-sena/backend/internal/auth"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	"github.com/ryuma04/tapu-sena/backend/internal/githubpush"
	"github.com/ryuma04/tapu-sena/backend/internal/httpx"
	"github.com/ryuma04/tapu-sena/backend/internal/runs"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type Service struct {
	cfg         *config.Config
	store       *store.Store
	runs        *runs.Service
	push        *githubpush.Service
	agents      *agentsclient.Client
	http        *http.Client
	botUsername string
}

func New(cfg *config.Config, st *store.Store, rs *runs.Service, ps *githubpush.Service, ac *agentsclient.Client) *Service {
	return &Service{cfg: cfg, store: st, runs: rs, push: ps, agents: ac, http: &http.Client{Timeout: 60 * time.Second}}
}

// ---------- Telegram Bot API ----------

func (s *Service) call(ctx context.Context, method string, payload any, out any) error {
	if !s.cfg.TelegramConfigured() {
		b, _ := json.Marshal(payload)
		slog.Info("telegram (not configured, log only)", "method", method, "payload", string(b))
		return nil
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.telegram.org/bot"+s.cfg.TelegramBotToken+"/"+method, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var r struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return err
	}
	if !r.OK {
		return fmt.Errorf("telegram %s: %s", method, r.Description)
	}
	if out != nil {
		return json.Unmarshal(r.Result, out)
	}
	return nil
}

type button struct {
	Text string `json:"text"`
	Data string `json:"callback_data"`
}

func (s *Service) send(ctx context.Context, chatID int64, text string, buttons ...button) {
	payload := map[string]any{"chat_id": chatID, "text": text, "disable_web_page_preview": true}
	if len(buttons) > 0 {
		payload["reply_markup"] = map[string]any{"inline_keyboard": [][]button{buttons}}
	}
	if err := s.call(ctx, "sendMessage", payload, nil); err != nil {
		slog.Warn("telegram send", "err", err)
	}
}

func (s *Service) username(ctx context.Context) string {
	if s.botUsername != "" || !s.cfg.TelegramConfigured() {
		return s.botUsername
	}
	var me struct {
		Username string `json:"username"`
	}
	if err := s.call(ctx, "getMe", map[string]any{}, &me); err == nil {
		s.botUsername = me.Username
	}
	return s.botUsername
}

// ---------- linking ----------

// POST /telegram/link — returns a one-time code: send "/start <code>" to the bot.
func (s *Service) Link(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	uid := auth.UserID(ctx)
	code := strings.ToUpper(auth.RandomToken(5))
	code = strings.NewReplacer("-", "X", "_", "Y").Replace(code)
	if _, err := s.store.Pool.Exec(ctx, `
		INSERT INTO telegram_links (user_id, link_code) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET link_code = EXCLUDED.link_code`, uid, code); err != nil {
		return err
	}
	out := map[string]any{"code": code, "configured": s.cfg.TelegramConfigured(), "instructions": "Send /start " + code + " to the bot"}
	if u := s.username(ctx); u != "" {
		out["deep_link"] = "https://t.me/" + u + "?start=" + code
	}
	var chatID *int64
	_ = s.store.Pool.QueryRow(ctx, `SELECT chat_id FROM telegram_links WHERE user_id=$1`, uid).Scan(&chatID)
	out["linked"] = chatID != nil
	httpx.JSON(w, http.StatusOK, out)
	return nil
}

func (s *Service) userForChat(ctx context.Context, chatID int64) (int64, error) {
	var uid int64
	err := s.store.Pool.QueryRow(ctx, `SELECT user_id FROM telegram_links WHERE chat_id=$1`, chatID).Scan(&uid)
	return uid, err
}

// ---------- webhook ----------

type update struct {
	Message *struct {
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
		Text  string `json:"text"`
		Voice *struct {
			FileID   string `json:"file_id"`
			Duration int    `json:"duration"`
		} `json:"voice"`
		Audio *struct {
			FileID string `json:"file_id"`
		} `json:"audio"`
	} `json:"message"`
	CallbackQuery *struct {
		ID      string `json:"id"`
		Data    string `json:"data"`
		Message struct {
			Chat struct {
				ID int64 `json:"id"`
			} `json:"chat"`
		} `json:"message"`
	} `json:"callback_query"`
}

// POST /telegram/webhook
func (s *Service) Webhook(w http.ResponseWriter, r *http.Request) error {
	if s.cfg.TelegramWebhookSecret != "" && r.Header.Get("X-Telegram-Bot-Api-Secret-Token") != s.cfg.TelegramWebhookSecret {
		return httpx.ErrForbidden
	}
	var u update
	if err := httpx.Decode(r, &u); err != nil {
		return err
	}
	// Answer Telegram immediately; handle the update in the background.
	w.WriteHeader(http.StatusOK)
	go s.handleUpdate(context.Background(), u)
	return nil
}

func (s *Service) handleUpdate(ctx context.Context, u update) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if cq := u.CallbackQuery; cq != nil {
		_ = s.call(ctx, "answerCallbackQuery", map[string]any{"callback_query_id": cq.ID}, nil)
		s.handleCallback(ctx, cq.Message.Chat.ID, cq.Data)
		return
	}
	m := u.Message
	if m == nil {
		return
	}
	chatID := m.Chat.ID
	if strings.HasPrefix(m.Text, "/start") {
		code := strings.TrimSpace(strings.TrimPrefix(m.Text, "/start"))
		s.linkChat(ctx, chatID, code)
		return
	}
	uid, err := s.userForChat(ctx, chatID)
	if err != nil {
		s.send(ctx, chatID, "This chat is not linked yet. Open your profile in the web app, tap \"Connect Telegram\" and send /start <code> here.")
		return
	}
	text := m.Text
	if m.Voice != nil || m.Audio != nil {
		fileID := ""
		if m.Voice != nil {
			fileID = m.Voice.FileID
		} else {
			fileID = m.Audio.FileID
		}
		t, err := s.transcribe(ctx, fileID)
		if err != nil {
			s.send(ctx, chatID, "Sorry, I could not understand the voice note: "+err.Error())
			return
		}
		s.send(ctx, chatID, "🎙 I heard: \""+t+"\"")
		text = t
	}
	if strings.TrimSpace(text) == "" {
		return
	}
	s.handleCommand(ctx, uid, chatID, text)
}

func (s *Service) linkChat(ctx context.Context, chatID int64, code string) {
	if code == "" {
		s.send(ctx, chatID, "Welcome! To link this chat, open your profile in the web app, tap \"Connect Telegram\" and send /start <code>.")
		return
	}
	tag, err := s.store.Pool.Exec(ctx, `
		UPDATE telegram_links SET chat_id=$2, linked_at=now(), link_code=NULL WHERE link_code=$1`, strings.ToUpper(code), chatID)
	if err != nil || tag.RowsAffected() == 0 {
		s.send(ctx, chatID, "That code is not valid. Create a new one in your profile.")
		return
	}
	s.send(ctx, chatID, "✅ Linked! You will get run updates here. Ask me things like \"How is the run going?\" or send a voice note: \"Try temperature 5 as a new branch\".")
}

func (s *Service) runContexts(ctx context.Context, uid int64) ([]agentsclient.RunContext, []*store.Run) {
	list, err := s.store.ActiveRunsForUser(ctx, uid)
	if err != nil {
		return nil, nil
	}
	out := make([]agentsclient.RunContext, 0, len(list))
	for _, r := range list {
		rc := agentsclient.RunContext{ID: r.ID, WorkspaceID: r.WorkspaceID, Status: r.Status, Stage: r.Stage}
		if ws, err := s.store.WorkspaceByID(ctx, r.WorkspaceID); err == nil {
			rc.Title = ws.Title
		}
		if cps, err := s.store.Checkpoints(ctx, r.ID); err == nil {
			for _, c := range cps {
				if c.Status == "pending" {
					rc.Pending = c.Name
				}
			}
		}
		out = append(out, rc)
	}
	return out, list
}

func (s *Service) handleCommand(ctx context.Context, uid, chatID int64, text string) {
	rcs, list := s.runContexts(ctx, uid)
	intent, err := s.agents.Intent(ctx, text, rcs)
	if err != nil {
		slog.Warn("intent", "err", err)
		s.send(ctx, chatID, "The agent service is not reachable right now; please try again in a moment.")
		return
	}
	if intent.RunID == 0 && len(list) > 0 {
		intent.RunID = list[0].ID
	}
	switch intent.Action {
	case "status":
		if intent.RunID == 0 {
			s.send(ctx, chatID, "You have no runs yet.")
			return
		}
		summary, err := s.agents.Summary(ctx, intent.RunID)
		if err != nil || summary == "" {
			r, _ := s.store.RunByID(ctx, intent.RunID)
			if r != nil {
				summary = fmt.Sprintf("Run #%d is %s (stage: %s).", r.ID, r.Status, r.Stage)
			}
		}
		s.send(ctx, chatID, summary)
	case "help", "unknown", "":
		reply := intent.Reply
		if reply == "" {
			reply = "I can: report status, approve or reject a checkpoint, start a what-if branch (\"try temperature 5\"), pause, resume or stop a run, and push results to GitHub."
		}
		s.send(ctx, chatID, reply)
	default:
		if intent.RunID == 0 {
			s.send(ctx, chatID, "I could not find a run for that.")
			return
		}
		// Everything that changes the work needs a one-tap confirmation.
		action, _ := json.Marshal(intent)
		id := auth.RandomToken(8)
		if _, err := s.store.Pool.Exec(ctx, `INSERT INTO telegram_pending (id, user_id, chat_id, action) VALUES ($1,$2,$3,$4)`,
			id, uid, chatID, action); err != nil {
			s.send(ctx, chatID, "Something went wrong saving that request.")
			return
		}
		s.send(ctx, chatID, describe(intent)+"\nConfirm?", button{"✅ Yes", "y:" + id}, button{"❌ No", "n:" + id})
	}
}

func describe(i *agentsclient.Intent) string {
	switch i.Action {
	case "approve", "reject", "edit":
		cp := i.Checkpoint
		if cp == "" {
			cp = "pending"
		}
		s := fmt.Sprintf("%s the %s checkpoint of run #%d", strings.Title(i.Action), cp, i.RunID) //nolint:staticcheck
		if i.Instruction != "" {
			s += ": " + i.Instruction
		}
		return s
	case "whatif":
		return fmt.Sprintf("Start a what-if on run #%d: %s", i.RunID, i.Question)
	case "push":
		return fmt.Sprintf("Push run #%d to GitHub", i.RunID)
	case "instruct":
		return fmt.Sprintf("Send instruction to run #%d: %s", i.RunID, i.Instruction)
	}
	return fmt.Sprintf("%s run #%d", strings.Title(i.Action), i.RunID) //nolint:staticcheck
}

// handleCallback runs a confirmed action ("y:<id>"), or a direct checkpoint button ("cp:<run>:<name>:<action>").
func (s *Service) handleCallback(ctx context.Context, chatID int64, data string) {
	uid, err := s.userForChat(ctx, chatID)
	if err != nil {
		return
	}
	parts := strings.Split(data, ":")
	switch {
	case len(parts) == 4 && parts[0] == "cp":
		runID, _ := strconv.ParseInt(parts[1], 10, 64)
		s.execute(ctx, uid, chatID, &agentsclient.Intent{Action: parts[3], RunID: runID, Checkpoint: parts[2]})
	case len(parts) == 2 && (parts[0] == "y" || parts[0] == "n"):
		var raw []byte
		err := s.store.Pool.QueryRow(ctx, `DELETE FROM telegram_pending WHERE id=$1 AND user_id=$2 RETURNING action`, parts[1], uid).Scan(&raw)
		if err != nil {
			s.send(ctx, chatID, "That request has expired.")
			return
		}
		if parts[0] == "n" {
			s.send(ctx, chatID, "Cancelled.")
			return
		}
		var intent agentsclient.Intent
		_ = json.Unmarshal(raw, &intent)
		s.execute(ctx, uid, chatID, &intent)
	}
}

// execute performs an action as the linked user, with the same permission checks as the web API.
func (s *Service) execute(ctx context.Context, uid, chatID int64, in *agentsclient.Intent) {
	ctx = auth.WithUserID(ctx, uid)
	run, err := s.store.RunByID(ctx, in.RunID)
	if err != nil {
		s.send(ctx, chatID, "Run not found.")
		return
	}
	ws, err := s.store.WorkspaceForUser(ctx, run.WorkspaceID, uid)
	if err != nil || (ws.Role != "owner" && ws.Role != "editor") {
		s.send(ctx, chatID, "You do not have permission to change this run.")
		return
	}
	reply := "Done."
	switch in.Action {
	case "approve", "reject", "edit":
		cp := in.Checkpoint
		if cp == "" {
			cps, _ := s.store.Checkpoints(ctx, run.ID)
			for _, c := range cps {
				if c.Status == "pending" {
					cp = c.Name
				}
			}
		}
		if cp == "" {
			s.send(ctx, chatID, "There is no checkpoint waiting for approval.")
			return
		}
		if cp == "push" {
			if in.Action == "approve" {
				_, err = s.push.Start(ctx, run, uid, "", "telegram")
				reply = "Push started. I'll send the repository link when it is done."
			} else {
				reply = "OK, not pushing."
			}
			break
		}
		_, err = s.runs.Resolve(ctx, run.ID, cp, runs.CheckpointResponse{Action: in.Action, Instruction: in.Instruction}, uid, "telegram")
		reply = fmt.Sprintf("Checkpoint %s: %s.", cp, in.Action)
	case "whatif":
		_, err = s.runs.WhatIf(ctx, run, in.Question, uid, "telegram")
		reply = "What-if started. Weak branches will be stopped early; I'll report the result."
	case "push":
		_, err = s.push.Start(ctx, run, uid, "", "telegram")
		reply = "Push started. I'll send the repository link when it is done."
	case "pause", "resume", "stop", "retry":
		_, err = s.runs.Act(ctx, run, "run", in.Action, "", "telegram")
		reply = fmt.Sprintf("Run #%d: %s requested.", run.ID, in.Action)
	case "instruct":
		_, err = s.runs.Act(ctx, run, "run", "instruct", in.Instruction, "telegram")
		reply = "Instruction sent to the team."
	default:
		reply = "I don't know how to do that yet."
	}
	if err != nil {
		reply = "Could not do that: " + err.Error()
	}
	s.send(ctx, chatID, reply)
}

// ---------- voice ----------

func (s *Service) transcribe(ctx context.Context, fileID string) (string, error) {
	if s.cfg.GroqAPIKey == "" {
		return "", fmt.Errorf("voice is not configured (GROQ_API_KEY missing)")
	}
	var f struct {
		FilePath string `json:"file_path"`
	}
	if err := s.call(ctx, "getFile", map[string]any{"file_id": fileID}, &f); err != nil {
		return "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.telegram.org/file/bot"+s.cfg.TelegramBotToken+"/"+f.FilePath, nil)
	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	audio, err := io.ReadAll(io.LimitReader(resp.Body, 25<<20))
	resp.Body.Close()
	if err != nil {
		return "", err
	}
	return Transcribe(ctx, s.http, s.cfg.GroqAPIKey, s.cfg.WhisperModel, "voice.ogg", audio)
}

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

// POST /voice/command (multipart "audio") — voice from the mobile web app; returns the text and intent.
func (s *Service) VoiceCommand(w http.ResponseWriter, r *http.Request) error {
	if s.cfg.GroqAPIKey == "" {
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
	text, err := Transcribe(r.Context(), s.http, s.cfg.GroqAPIKey, s.cfg.WhisperModel, fh.Filename, audio)
	if err != nil {
		return httpx.Errorf(http.StatusBadGateway, "transcription failed: "+err.Error())
	}
	rcs, _ := s.runContexts(r.Context(), auth.UserID(r.Context()))
	intent, err := s.agents.Intent(r.Context(), text, rcs)
	if err != nil {
		return httpx.Errorf(http.StatusBadGateway, "agent service unavailable")
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"text": text, "intent": intent})
	return nil
}

// ---------- notifications ----------

// Notify is registered as a bus hook: it forwards important events to the workspace owner's chat.
func (s *Service) Notify(ctx context.Context, e store.Event) {
	var text string
	var buttons []button
	switch e.Type {
	case "checkpoint_waiting":
		var l struct {
			Checkpoint string `json:"checkpoint"`
		}
		_ = json.Unmarshal(e.Links, &l)
		text = fmt.Sprintf("⏸ Run #%d needs your approval: %s", e.RunID, e.Message)
		if l.Checkpoint != "" {
			buttons = []button{
				{"✅ Approve", fmt.Sprintf("cp:%d:%s:approve", e.RunID, l.Checkpoint)},
				{"❌ Reject", fmt.Sprintf("cp:%d:%s:reject", e.RunID, l.Checkpoint)},
			}
		}
	case "run_completed":
		text = fmt.Sprintf("🏁 %s\nApprove push to GitHub?", e.Message)
		buttons = []button{{"✅ Yes", fmt.Sprintf("cp:%d:push:approve", e.RunID)}, {"❌ No", fmt.Sprintf("cp:%d:push:reject", e.RunID)}}
	case "run_failed", "push_blocked", "push_failed":
		text = "⚠️ Run #" + fmt.Sprint(e.RunID) + ": " + e.Message
	case "push_done":
		var l struct {
			RepoURL string `json:"repo_url"`
		}
		_ = json.Unmarshal(e.Links, &l)
		text = "📦 " + e.Message + "\n" + l.RepoURL
	case "whatif_finished", "gap_explained":
		text = "🔎 " + e.Message
	default:
		return
	}
	var chatID int64
	err := s.store.Pool.QueryRow(ctx, `
		SELECT t.chat_id FROM runs r JOIN workspaces w ON w.id = r.workspace_id
		JOIN telegram_links t ON t.user_id = w.owner_id
		WHERE r.id=$1 AND t.chat_id IS NOT NULL`, e.RunID).Scan(&chatID)
	if err != nil {
		return
	}
	s.send(ctx, chatID, text, buttons...)
}
