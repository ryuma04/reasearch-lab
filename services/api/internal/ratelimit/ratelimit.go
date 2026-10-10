// Package ratelimit keeps per-model AI usage counters in Redis so the agent worker can wait or
// switch provider before hitting free-tier limits (allaboutourproject.md, Section 15).
package ratelimit

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ryuma04/tapu-sena/services/api/internal/httpx"
)

type Limit struct {
	PerMinute int `json:"per_minute"`
	PerDay    int `json:"per_day"`
}

// Conservative defaults, kept below the published free limits. Override per model with
// RATE_LIMITS="groq:llama-3.1-8b-instant=30/14000,gemini:*=10/250".
var defaults = map[string]Limit{
	"groq:*":                       {PerMinute: 28, PerDay: 900},
	"groq:llama-3.1-8b-instant":    {PerMinute: 28, PerDay: 14000},
	"groq:llama-3.3-70b-versatile": {PerMinute: 28, PerDay: 950},
	"groq:whisper-large-v3-turbo":  {PerMinute: 18, PerDay: 1900},
	"gemini:*":                     {PerMinute: 9, PerDay: 240},
	"openrouter:*":                 {PerMinute: 18, PerDay: 190},
}

type Service struct {
	rdb    *redis.Client
	limits map[string]Limit
}

func New(rdb *redis.Client, override string) *Service {
	limits := map[string]Limit{}
	for k, v := range defaults {
		limits[k] = v
	}
	for _, part := range strings.Split(override, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		var l Limit
		if _, err := fmt.Sscanf(v, "%d/%d", &l.PerMinute, &l.PerDay); err == nil {
			limits[k] = l
		}
	}
	return &Service{rdb: rdb, limits: limits}
}

func (s *Service) limitFor(provider, model string) Limit {
	if l, ok := s.limits[provider+":"+model]; ok {
		return l
	}
	if l, ok := s.limits[provider+":*"]; ok {
		return l
	}
	return Limit{PerMinute: 20, PerDay: 500}
}

type Decision struct {
	Allowed      bool  `json:"allowed"`
	RetryAfterMs int64 `json:"retry_after_ms"`
	UsedMinute   int64 `json:"used_minute"`
	UsedDay      int64 `json:"used_day"`
	Limit        Limit `json:"limit"`
}

// Acquire counts one request if both the minute and day windows have room.
func (s *Service) Acquire(ctx context.Context, provider, model string) (*Decision, error) {
	l := s.limitFor(provider, model)
	now := time.Now().UTC()
	minKey := fmt.Sprintf("lab:rl:%s:%s:m:%s", provider, model, now.Format("200601021504"))
	dayKey := fmt.Sprintf("lab:rl:%s:%s:d:%s", provider, model, now.Format("20060102"))

	pipe := s.rdb.TxPipeline()
	m := pipe.Incr(ctx, minKey)
	d := pipe.Incr(ctx, dayKey)
	pipe.Expire(ctx, minKey, 2*time.Minute)
	pipe.Expire(ctx, dayKey, 26*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	dec := &Decision{Allowed: true, UsedMinute: m.Val(), UsedDay: d.Val(), Limit: l}
	switch {
	case d.Val() > int64(l.PerDay):
		dec.Allowed = false
		dec.RetryAfterMs = time.Until(now.Truncate(24 * time.Hour).Add(24 * time.Hour)).Milliseconds()
	case m.Val() > int64(l.PerMinute):
		dec.Allowed = false
		dec.RetryAfterMs = time.Until(now.Truncate(time.Minute).Add(time.Minute)).Milliseconds()
	}
	if !dec.Allowed { // do not count rejected requests
		s.rdb.Decr(ctx, minKey)
		s.rdb.Decr(ctx, dayKey)
	}
	return dec, nil
}

// POST /internal/ratelimit/acquire {"provider": "groq", "model": "..."}
func (s *Service) Handle(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	if err := httpx.Decode(r, &body); err != nil {
		return err
	}
	if body.Provider == "" {
		return httpx.Errorf(http.StatusBadRequest, "provider is required")
	}
	dec, err := s.Acquire(r.Context(), body.Provider, body.Model)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, dec)
	return nil
}

// GET /internal/ratelimit/usage — today's counters per model.
func (s *Service) Usage(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	day := time.Now().UTC().Format("20060102")
	keys, err := s.rdb.Keys(ctx, "lab:rl:*:d:"+day).Result()
	if err != nil {
		return err
	}
	out := map[string]any{}
	for _, k := range keys {
		n, _ := s.rdb.Get(ctx, k).Int64()
		parts := strings.Split(k, ":")
		if len(parts) >= 4 {
			pm := parts[2] + ":" + strings.Join(parts[3:len(parts)-2], ":")
			out[pm] = map[string]any{"used_today": n, "limit": s.limitFor(parts[2], strings.Join(parts[3:len(parts)-2], ":"))}
		}
	}
	httpx.JSON(w, http.StatusOK, out)
	return nil
}
