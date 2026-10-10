package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/ryuma04/tapu-sena/backend/internal/bus"
	"github.com/ryuma04/tapu-sena/backend/internal/config"
	mcp_pkg "github.com/ryuma04/tapu-sena/backend/internal/mcp"
	"github.com/ryuma04/tapu-sena/backend/internal/sandbox"
	"github.com/ryuma04/tapu-sena/backend/internal/store"
)

// Main entrypoint for Stdio MCP transport (for Gemini CLI, Claude Code, Claude Desktop, Cursor).
func main() {
	if exe, err := os.Executable(); err == nil {
		_ = os.Chdir(filepath.Dir(exe))
	}

	// Send logs to stderr so stdout remains purely MCP JSON-RPC protocol
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn})))

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}

	ctx := context.Background()
	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "database error: %v\n", err)
		os.Exit(1)
	}
	defer st.Close()

	b, _ := bus.New(ctx, cfg.RedisURL, st)
	sbx := sandbox.New(cfg, st, b)

	devUser := &store.User{ID: 1, Name: "Developer", Email: "dev@research.local"}
	srv := mcp_pkg.NewServer(cfg, st, b, sbx, devUser)
	server := srv.BuildMCPServer()
	if err := server.Run(ctx, &mcp.StdioTransport{}); err != nil {
		fmt.Fprintf(os.Stderr, "mcp server run error: %v\n", err)
		os.Exit(1)
	}
}
