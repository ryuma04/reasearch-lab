package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Regression test for audit INT-01: the browser client sends X-Requested-With on every
// mutation, so the preflight must allow it.
func TestCORSPreflightAllowsClientHeaders(t *testing.T) {
	h := CORS("http://localhost:3000")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	req := httptest.NewRequest(http.MethodOptions, "/workspaces", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "content-type,x-requested-with")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d", rec.Code)
	}
	allowed := strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers"))
	for _, want := range []string{"content-type", "x-requested-with", "x-csrf-token", "last-event-id"} {
		if !strings.Contains(allowed, want) {
			t.Errorf("Access-Control-Allow-Headers %q is missing %s", allowed, want)
		}
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" ||
		rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Errorf("origin/credentials headers wrong: %v", rec.Header())
	}

	other := httptest.NewRequest(http.MethodOptions, "/workspaces", nil)
	other.Header.Set("Origin", "https://evil.example")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, other)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("unknown origin must not be allowed")
	}
}

func TestCSRF(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	h := CSRF("lab_session")(ok)
	cases := []struct {
		name    string
		method  string
		cookie  bool
		headers map[string]string
		want    int
	}{
		{"get with cookie", http.MethodGet, true, nil, 200},
		{"post with cookie, no header", http.MethodPost, true, nil, 403},
		{"post with cookie and header", http.MethodPost, true, map[string]string{"X-Requested-With": "XMLHttpRequest"}, 200},
		{"post with bearer", http.MethodPost, true, map[string]string{"Authorization": "Bearer x"}, 200},
		{"post internal", http.MethodPost, false, map[string]string{"X-Internal-Token": "t"}, 200},
		{"post without cookie", http.MethodPost, false, nil, 200},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, "/x", nil)
		if c.cookie {
			req.AddCookie(&http.Cookie{Name: "lab_session", Value: "v"})
		}
		for k, v := range c.headers {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: got %d want %d", c.name, rec.Code, c.want)
		}
	}
}
