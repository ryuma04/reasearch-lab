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

	SandboxMode        string // docker (the only mode: code never runs on the host)
	SandboxImagePython string
	SandboxImageR      string
	SandboxCPUs        string
	SandboxMemory      string
	SandboxPids        string
	SandboxTmpfs       string
	SandboxHostDataDir string
	// SandboxTimeoutSec is the default execution time limit; SandboxMaxTimeoutSec caps any request.
	SandboxTimeoutSec    int
	SandboxMaxTimeoutSec int
	// Artifact limits (per file and per execution).
	SandboxMaxArtifactMB      int64
	SandboxMaxArtifactTotalMB int64

	GitleaksBin        string

	// HFToken is only checked for presence here (the agent worker uploads with it); never logged or sent.
	HFToken string

	// ElevenLabs keys (Paper-to-Video Explainer) are used only by the agent worker; the API checks presence.
	ElevenLabsKeys string

	// Claude and Arina AI Orchestration
	AnthropicAPIKey string
	ClaudeModel     string
	ArinaAPIKey     string
	ArinaBaseURL    string
	ArinaModel      string
}

func (c *Config) GitHubConfigured() bool { return c.GitHubClientID != "" && c.GitHubClientSecret != "" }

func (c *Config) ElevenLabsConfigured() bool { return strings.Trim(c.ElevenLabsKeys, ", ") != "" }

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

		DatabaseURL: strings.TrimSpace(get("DATABASE_URL", "postgres://lab:lab@localhost:5433/lab?sslmode=disable")),
		RedisURL:    strings.TrimSpace(get("REDIS_URL", "redis://localhost:6379/0")),
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
		SandboxCPUs:        get("SANDBOX_CPUS", "2"),
		SandboxMemory:      get("SANDBOX_MEMORY", "4g"),
		SandboxPids:        get("SANDBOX_PIDS", "256"),
		SandboxTmpfs:       get("SANDBOX_TMPFS", "512m"),
		SandboxHostDataDir: get("SANDBOX_HOST_DATA_DIR", ""),

		SandboxTimeoutSec:         getInt("SANDBOX_TIMEOUT_SEC", 300),
		SandboxMaxTimeoutSec:      getInt("SANDBOX_MAX_TIMEOUT_SEC", 3*3600),
		SandboxMaxArtifactMB:      int64(getInt("SANDBOX_MAX_ARTIFACT_MB", 512)),
		SandboxMaxArtifactTotalMB: int64(getInt("SANDBOX_MAX_ARTIFACTS_TOTAL_MB", 2048)),

		GitleaksBin:        get("GITLEAKS_BIN", "gitleaks"),
		HFToken:            get("HF_TOKEN", ""),
		ElevenLabsKeys:     get("ELEVENLABS_API_KEYS", "") + "," + get("ELEVENLABS_API_KEY", ""),

		AnthropicAPIKey: get("ANTHROPIC_API_KEY", ""),
		ClaudeModel:     get("CLAUDE_MODEL", "claude-3-7-sonnet-20250219"),
		ArinaAPIKey:     get("ARINA_API_KEY", get("ELEVATE_TEAM_API_KEY", "")),
		ArinaBaseURL:    strings.TrimRight(get("ARINA_BASE_URL", "https://elevate1-0.vercel.app/api/ai"), "/"),
		ArinaModel:      get("ARINA_MODEL", "gpt-5-mini"),
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
	// Generated code only ever runs inside Docker; the old no-isolation "local" mode was removed.
	if c.SandboxMode != "docker" {
		return nil, fmt.Errorf("SANDBOX_MODE must be docker: generated code is never executed on the host")
	}
	if c.SandboxTimeoutSec <= 0 || c.SandboxMaxTimeoutSec < c.SandboxTimeoutSec {
		return nil, fmt.Errorf("SANDBOX_TIMEOUT_SEC must be positive and not above SANDBOX_MAX_TIMEOUT_SEC")
	}
	return c, nil
}

func getInt(key string, def int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return def
	}
	return n
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
	checkDir := func(start string) string {
		dir := start
		for i := 0; i < 5; i++ {
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
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
		return ""
	}

	if dir, err := os.Getwd(); err == nil {
		if found := checkDir(dir); found != "" {
			return found
		}
	}

	if exe, err := os.Executable(); err == nil {
		if found := checkDir(filepath.Dir(exe)); found != "" {
			return found
		}
	}
	return ""
}

