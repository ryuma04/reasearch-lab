// Package httpx has small JSON/HTTP helpers and middleware shared by all handlers.
package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

type Error struct {
	Status  int    `json:"-"`
	Message string `json:"error"`
}

func (e *Error) Error() string { return e.Message }

func Errorf(status int, msg string) *Error { return &Error{Status: status, Message: msg} }

var (
	ErrUnauthorized = Errorf(http.StatusUnauthorized, "not logged in")
	ErrForbidden    = Errorf(http.StatusForbidden, "you do not have access to this resource")
)

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// Fail writes an error response. Unknown errors become 500 and are logged, never leaked.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	var he *Error
	switch {
	case errors.As(err, &he):
		JSON(w, he.Status, he)
	case errors.Is(err, store.ErrNotFound):
		JSON(w, http.StatusNotFound, Errorf(http.StatusNotFound, "not found"))
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		JSON(w, http.StatusInternalServerError, Errorf(http.StatusInternalServerError, "internal error"))
	}
}

// Handler adapts a func returning an error into an http.HandlerFunc.
func Handler(fn func(w http.ResponseWriter, r *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			Fail(w, r, err)
		}
	}
}

func Decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		return Errorf(http.StatusBadRequest, "invalid JSON body: "+err.Error())
	}
	return nil
}

func IDParam(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		return 0, Errorf(http.StatusBadRequest, "invalid "+name)
	}
	return id, nil
}

// CORS allows the configured frontend origin with credentials (cookies).
func CORS(allowedOrigins ...string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range allowedOrigins {
		allowed[strings.TrimRight(o, "/")] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && allowed[origin] {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Last-Event-ID, X-Requested-With, X-CSRF-Token")
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				h.Add("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CSRF rejects state-changing browser requests that rely on the session cookie but lack the
// X-Requested-With header. A cross-site form cannot set that header, and a cross-site fetch
// that sets it fails the CORS preflight unless the origin is allowed. Requests authenticated
// with a Bearer token or X-Internal-Token (curl, agent worker, n8n) are not cookie-based.
func CSRF(cookieName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if _, err := r.Cookie(cookieName); err == nil &&
				!strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") &&
				r.Header.Get("X-Internal-Token") == "" &&
				r.Header.Get("X-Requested-With") == "" {
				JSON(w, http.StatusForbidden, Errorf(http.StatusForbidden, "missing X-Requested-With header"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
