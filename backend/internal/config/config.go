// Package config loads all settings from environment variables (and an optional .env file).
package config

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Env             string
	Addr            string
	PublicAPIURL    string
	FrontendURL     string
	DevLoginEnabled bool
	// EmailLoginEnabled allows email + password accounts next to GitHub login.
	EmailLoginEnabled bool

	DatabaseURL string
	RedisURL    string
	DataDir     string
	AgentsURL   string // Python FastAPI agent service
	RateLimits  string // optional per-model overrides

	TokenKey      []byte // 32 bytes, AES-256-GCM
	SessionSecret []byte
	InternalToken string

	GitHubClientID     string
	GitHubClientSecret string

	GroqAPIKey   string
	GroqAPIKeys  []string // all keys, rotated when one hits its limit
	GeminiAPIKey string
	WhisperModel string
	FastModel    string

	SandboxMode        string // docker | local
	SandboxImagePython string
	SandboxImageR      string
	SandboxCPUs        string
	SandboxMemory      string
	SandboxPids        string
	SandboxHostDataDir string

	N8NWebhookURL      string
	PushDirectFallback bool
	GitleaksBin        string
}

func (c *Config) GitHubConfigured() bool { return c.GitHubClientID != "" && c.GitHubClientSecret != "" }

// Load reads .env (from the working directory or up to three parents) without
// overriding variables that are already set, then builds the Config.
func Load() (*Config, error) {
	envDir := loadDotEnv()

	c := &Config{
		Env:               get("APP_ENV", "development"),
		Addr:              get("API_ADDR", ":8080"),
		PublicAPIURL:      strings.TrimRight(get("PUBLIC_API_URL", "http://localhost:8080"), "/"),
		FrontendURL:       strings.TrimRight(get("FRONTEND_URL", "http://localhost:3000"), "/"),
		DevLoginEnabled:   getBool("DEV_LOGIN_ENABLED", false),
		EmailLoginEnabled: getBool("EMAIL_LOGIN_ENABLED", true),

		DatabaseURL: get("DATABASE_URL", "postgres://lab:lab@localhost:5433/lab?sslmode=disable"),
		RedisURL:    get("REDIS_URL", "redis://localhost:6379/0"),
		DataDir:     get("DATA_DIR", "./data"),
		AgentsURL:   strings.TrimRight(get("AGENTS_URL", "http://localhost:8001"), "/"),
		RateLimits:  get("RATE_LIMITS", ""),

		SessionSecret: []byte(get("SESSION_SECRET", "")),
		InternalToken: get("INTERNAL_TOKEN", ""),

		GitHubClientID:     get("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret: get("GITHUB_CLIENT_SECRET", ""),

		GroqAPIKey:   firstKey(get("GROQ_API_KEYS", get("GROQ_API_KEY", ""))),
		GeminiAPIKey: firstKey(get("GEMINI_API_KEYS", get("GEMINI_API_KEY", ""))),
		WhisperModel: get("GROQ_MODEL_WHISPER", "whisper-large-v3-turbo"),
		FastModel:    get("GROQ_MODEL_FAST", "llama-3.1-8b-instant"),

		SandboxMode:        get("SANDBOX_MODE", "docker"),
		SandboxImagePython: get("SANDBOX_IMAGE_PYTHON", "tapu-sena/sandbox-python:latest"),
		SandboxImageR:      get("SANDBOX_IMAGE_R", "tapu-sena/sandbox-r:latest"),
		SandboxCPUs:        get("SANDBOX_CPUS", "4"),
		SandboxMemory:      get("SANDBOX_MEMORY", "6g"),
		SandboxPids:        get("SANDBOX_PIDS", "256"),
		SandboxHostDataDir: get("SANDBOX_HOST_DATA_DIR", ""),

		N8NWebhookURL:      get("N8N_WEBHOOK_URL", ""),
		PushDirectFallback: getBool("PUSH_DIRECT_FALLBACK", true),
		GitleaksBin:        get("GITLEAKS_BIN", "gitleaks"),
	}

	// A relative DATA_DIR is relative to the .env file, so api and agents agree.
	if !filepath.IsAbs(c.DataDir) && envDir != "" {
		c.DataDir = filepath.Join(envDir, c.DataDir)
	}
	for _, k := range strings.Split(get("GROQ_API_KEYS", get("GROQ_API_KEY", "")), ",") {
		if k = strings.TrimSpace(k); k != "" {
			c.GroqAPIKeys = append(c.GroqAPIKeys, k)
		}
	}

	abs, err := filepath.Abs(c.DataDir)
	if err != nil {
		return nil, fmt.Errorf("DATA_DIR: %w", err)
	}
	c.DataDir = abs
	if err := os.MkdirAll(c.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create DATA_DIR: %w", err)
	}

	key, err := hex.DecodeString(get("TOKEN_ENCRYPTION_KEY", ""))
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)")
	}
	c.TokenKey = key

	if len(c.SessionSecret) < 16 {
		return nil, fmt.Errorf("SESSION_SECRET must be at least 16 characters")
	}
	if c.InternalToken == "" {
		return nil, fmt.Errorf("INTERNAL_TOKEN must be set")
	}
	if c.SandboxMode != "docker" && c.SandboxMode != "local" {
		return nil, fmt.Errorf("SANDBOX_MODE must be docker or local")
	}
	// local runs AI-written code on this machine with no isolation (audit SEC-02).
	if c.SandboxMode == "local" && c.Env != "development" {
		return nil, fmt.Errorf("SANDBOX_MODE=local (no isolation) is only allowed with APP_ENV=development")
	}
	return c, nil
}

// firstKey returns the first of a comma-separated list of API keys.
func firstKey(list string) string {
	k, _, _ := strings.Cut(list, ",")
	return strings.TrimSpace(k)
}

func get(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getBool(key string, def bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// loadDotEnv returns the directory the .env file was found in ("" if none).
func loadDotEnv() string {
	dir, _ := os.Getwd()
	for i := 0; i < 4; i++ {
		f, err := os.Open(filepath.Join(dir, ".env"))
		if err == nil {
			defer f.Close()
			sc := bufio.NewScanner(f)
			for sc.Scan() {
				line := strings.TrimSpace(sc.Text())
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				k, v, ok := strings.Cut(line, "=")
				if !ok {
					continue
				}
				k = strings.TrimSpace(k)
				v = strings.Trim(strings.TrimSpace(v), `"'`)
				if _, exists := os.LookupEnv(k); !exists {
					os.Setenv(k, v)
				}
			}
			return dir
		}
		dir = filepath.Dir(dir)
	}
	return ""
}
