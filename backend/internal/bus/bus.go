// Package bus connects Go and the Python agent worker through Redis:
//
//	lab:jobs                      Go -> worker   (LPUSH / BRPOP) run, resume, whatif, retry jobs
//	lab:events                    worker -> Go   (LPUSH / BRPOP) every agent event
//	lab:run:{id}:control          Go -> worker   pause | stop | "" (checked between steps)
//	lab:run:{id}:instructions     Go -> worker   researcher instructions for agents
//
// Every event is saved to run_events (for Run Replay) and fanned out to SSE subscribers.
package bus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

const (
	JobsKey   = "lab:jobs"
	EventsKey = "lab:events"
)

func ControlKey(runID int64) string      { return fmt.Sprintf("lab:run:%d:control", runID) }
func InstructionsKey(runID int64) string { return fmt.Sprintf("lab:run:%d:instructions", runID) }

type Bus struct {
	Redis *redis.Client
	store *store.Store

	mu      sync.RWMutex
	subs    map[int64]map[chan store.Event]struct{}
	parents map[int64]int64 // child run -> parent run (cache)
	hooks   []func(context.Context, store.Event)
}

func New(ctx context.Context, url string, st *store.Store) (*Bus, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(opt)
	deadline := time.Now().Add(60 * time.Second)
	for {
		if err = rdb.Ping(ctx).Err(); err == nil {
			break
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("connect redis: %w", err)
		}
		slog.Info("waiting for redis", "err", err)
		time.Sleep(2 * time.Second)
	}
	return &Bus{Redis: rdb, store: st, subs: map[int64]map[chan store.Event]struct{}{}, parents: map[int64]int64{}}, nil
}

// OnEvent registers a hook called for every saved event (e.g. notifications).
func (b *Bus) OnEvent(fn func(context.Context, store.Event)) { b.hooks = append(b.hooks, fn) }

// Enqueue sends a job to the Python worker.
func (b *Bus) Enqueue(ctx context.Context, job map[string]any) error {
	job["enqueued_at"] = time.Now().UTC().Format(time.RFC3339)
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return b.Redis.LPush(ctx, JobsKey, data).Err()
}

func (b *Bus) SetControl(ctx context.Context, runID int64, value string) error {
	if value == "" {
		return b.Redis.Del(ctx, ControlKey(runID)).Err()
	}
	return b.Redis.Set(ctx, ControlKey(runID), value, 24*time.Hour).Err()
}

func (b *Bus) PushInstruction(ctx context.Context, runID int64, agent, text string) error {
	data, _ := json.Marshal(map[string]any{"agent": agent, "text": text, "time": time.Now().UTC()})
	pipe := b.Redis.TxPipeline()
	pipe.RPush(ctx, InstructionsKey(runID), data)
	pipe.Expire(ctx, InstructionsKey(runID), 7*24*time.Hour)
	_, err := pipe.Exec(ctx)
	return err
}

// Emit saves and broadcasts an event produced by Go itself (sandbox, push, checkpoints).
func (b *Bus) Emit(ctx context.Context, e store.Event) {
	if err := b.store.InsertEvent(ctx, &e); err != nil {
		slog.Error("save event", "err", err)
		return
	}
	b.dispatch(ctx, e)
}

// RunIngest consumes worker events from Redis until ctx is cancelled.
func (b *Bus) RunIngest(ctx context.Context) {
	for ctx.Err() == nil {
		res, err := b.Redis.BRPop(ctx, 5*time.Second, EventsKey).Result()
		if errors.Is(err, redis.Nil) || ctx.Err() != nil {
			continue
		}
		if err != nil {
			slog.Warn("event ingest", "err", err)
			time.Sleep(time.Second)
			continue
		}
		var e store.Event
		if err := json.Unmarshal([]byte(res[1]), &e); err != nil || e.RunID == 0 {
			slog.Warn("bad event from worker", "err", err, "raw", truncate(res[1], 200))
			continue
		}
		e.ID = 0
		if err := b.store.InsertEvent(ctx, &e); err != nil {
			slog.Error("save event", "err", err, "run_id", e.RunID)
			continue
		}
		b.dispatch(ctx, e)
	}
}

func (b *Bus) dispatch(ctx context.Context, e store.Event) {
	targets := []int64{e.RunID}
	if p := b.parentOf(ctx, e.RunID); p != 0 {
		targets = append(targets, p)
	}
	b.mu.RLock()
	for _, id := range targets {
		for ch := range b.subs[id] {
			select {
			case ch <- e:
			default: // slow subscriber: drop; it can catch up from /events
			}
		}
	}
	b.mu.RUnlock()
	for _, h := range b.hooks {
		go h(context.WithoutCancel(ctx), e)
	}
}

func (b *Bus) parentOf(ctx context.Context, runID int64) int64 {
	b.mu.RLock()
	p, ok := b.parents[runID]
	b.mu.RUnlock()
	if ok {
		return p
	}
	r, err := b.store.RunByID(ctx, runID)
	if err != nil {
		return 0
	}
	if r.ParentRunID != nil {
		p = *r.ParentRunID
	}
	b.mu.Lock()
	b.parents[runID] = p
	b.mu.Unlock()
	return p
}

// Subscribe returns a channel of live events for a run (including its child runs).
func (b *Bus) Subscribe(runID int64) (chan store.Event, func()) {
	ch := make(chan store.Event, 256)
	b.mu.Lock()
	if b.subs[runID] == nil {
		b.subs[runID] = map[chan store.Event]struct{}{}
	}
	b.subs[runID][ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		delete(b.subs[runID], ch)
		if len(b.subs[runID]) == 0 {
			delete(b.subs, runID)
		}
		b.mu.Unlock()
	}
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
