"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Key, Terminal } from "@phosphor-icons/react";
import { authApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, SectionTitle } from "@/components/ui/primitives";
import { CopyButton } from "@/components/ui/content";
import { toast } from "@/components/ui/overlays";

/** Connect an MCP client (Gemini CLI, Claude Code, Cursor) to /mcp as the logged-in user. */
export function McpConnectCard() {
  const [tok, setTok] = React.useState<{ token: string; expires_at: string; mcp_url: string } | null>(null);
  const create = useMutation({
    mutationFn: () => authApi.mcpToken(),
    onSuccess: setTok,
    onError: (e) => toast.error("Couldn't create a token", userMessage(e)),
  });
  const cmd = tok ? `gemini mcp add --scope user --transport http --timeout 600000 research-lab ${tok.mcp_url} -H "Authorization: Bearer ${tok.token}"` : "";

  return (
    <Card className="p-6">
      <SectionTitle kicker="Model Context Protocol" title="Connect Gemini CLI" action={<Badge tone="lavender">42 tools</Badge>} />
      <p className="mt-2 text-sm text-ink-soft">
        Use the lab from the Gemini CLI (or Claude Code, Cursor): read your papers, browse and edit code, run experiments in the Docker sandbox, compare metrics with the paper&apos;s claims.
        The token acts as <b>you</b>, only on workspaces you can access; publishing still needs your approval.
      </p>
      {!tok ? (
        <Button className="mt-4" variant="purple" loading={create.isPending} onClick={() => create.mutate()}><Key size={16} weight="bold" /> Create a CLI token</Button>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold"><Terminal size={18} /> 1. Run this once in a terminal:</p>
          <div className="flex items-start gap-2 rounded-2xl bg-pill p-3 pl-4">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-white">{cmd}</code>
            <CopyButton text={cmd} />
          </div>
          <p className="text-sm font-semibold">2. Start <code className="rounded bg-canvas px-1.5">gemini</code> and type <code className="rounded bg-canvas px-1.5">/mcp</code> to see the tools, then ask, for example:</p>
          <p className="rounded-2xl bg-canvas p-3 text-sm italic">&ldquo;List my workspaces and runs. For my latest finished run, show the paper&apos;s claims and compare them with the measured metrics.&rdquo;</p>
          <p className="text-xs text-muted">Keep the token private. It expires {formatDateTime(tok.expires_at)}; create a new one any time.</p>
        </div>
      )}
    </Card>
  );
}
