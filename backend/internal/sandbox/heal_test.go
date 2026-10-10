package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/ryuma04/tapu-sena/backend/internal/bus"
)

func (f *apiFixture) insertExec(status string) int64 {
	f.t.Helper()
	var id int64
	if err := f.st.Pool.QueryRow(context.Background(), `INSERT INTO sandbox_execs (run_id, phase, command, status, source, entrypoint, exit_code, error)
		VALUES ($1,'execute','python -u src/train.py',$2,'user','src/train.py',1,'boom') RETURNING id`, f.run.ID, status).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func TestHealRequestValidationAndQueue(t *testing.T) {
	f := newAPIFixture(t, &fakeRunner{})
	ctx := context.Background()
	_ = f.s.bus.Redis.Del(ctx, bus.JobsKey)
	ok := f.insertExec("succeeded")
	sandboxErr := f.insertExec("error")
	failed := f.insertExec("failed")

	if rec, _ := f.do("POST", f.runPath("/sandbox/heal"), f.other, map[string]int64{"exec_id": failed}); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger: %d", rec.Code)
	}
	if rec, _ := f.do("POST", f.runPath("/sandbox/heal"), f.owner, map[string]int64{"exec_id": ok}); rec.Code != http.StatusConflict {
		t.Fatalf("succeeded exec: %d", rec.Code)
	}
	if rec, out := f.do("POST", f.runPath("/sandbox/heal"), f.owner, map[string]int64{"exec_id": sandboxErr}); rec.Code != http.StatusConflict ||
		fmt.Sprint(out["error"]) == "" {
		t.Fatalf("sandbox error exec: %d %v", rec.Code, out)
	}
	if rec, _ := f.do("POST", f.runPath("/sandbox/heal"), f.owner, map[string]int64{"exec_id": 999999999}); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown exec: %d", rec.Code)
	}

	rec, out := f.do("POST", f.runPath("/sandbox/heal"), f.owner, map[string]int64{"exec_id": failed})
	if rec.Code != http.StatusAccepted || out["status"] != "queued" || out["max_attempts"] != float64(3) || out["entrypoint"] != "src/train.py" {
		t.Fatalf("start: %d %v", rec.Code, out)
	}
	sid := int64(out["id"].(float64))
	raw, err := f.s.bus.Redis.LIndex(ctx, bus.JobsKey, 0).Result()
	if err != nil {
		t.Fatal(err)
	}
	var job map[string]any
	_ = json.Unmarshal([]byte(raw), &job)
	if job["type"] != "heal" || job["session_id"] != float64(sid) || job["run_id"] != float64(f.run.ID) {
		t.Fatalf("job: %v", job)
	}
	// One session at a time; running and editing wait for it.
	if rec, _ := f.do("POST", f.runPath("/sandbox/heal"), f.owner, map[string]int64{"exec_id": failed}); rec.Code != http.StatusConflict {
		t.Fatalf("second session: %d", rec.Code)
	}
	if rec, _ := f.do("PUT", f.runPath("/file"), f.owner, map[string]string{"path": "src/train.py", "content": "x"}); rec.Code != http.StatusConflict {
		t.Fatalf("save during heal: %d", rec.Code)
	}

	// The worker records attempts; the list returns them for the editor.
	_, _ = f.st.Pool.Exec(ctx, `INSERT INTO repair_attempts (session_id, run_id, attempt, error_summary, fix_source, explanation, diff, status, tests)
		VALUES ($1,$2,1,'KeyError: lr','arina','Use the existing key.',$3,'fixed','{"passed":1,"failed":0}')`, sid, f.run.ID, "-a\n+b\n")
	_, _ = f.st.Pool.Exec(ctx, `UPDATE heal_sessions SET status='fixed', message='Fixed on attempt 1' WHERE id=$1`, sid)
	rec2, _ := f.do("GET", f.runPath("/sandbox/heal"), f.owner, nil)
	var list []HealSession
	_ = json.Unmarshal(rec2.Body.Bytes(), &list)
	if len(list) != 1 || list[0].Status != "fixed" || len(list[0].Attempts) != 1 || list[0].Attempts[0].Diff != "-a\n+b\n" {
		t.Fatalf("list: %s", rec2.Body.String())
	}
	if rec, _ := f.do("GET", f.runPath("/sandbox/heal"), f.other, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger list: %d", rec.Code)
	}
	_ = f.s.bus.Redis.Del(ctx, bus.JobsKey)
}
