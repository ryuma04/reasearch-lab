"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Flask } from "@phosphor-icons/react";
import { userMessage } from "@/lib/api/errors";
import { workspaceApi } from "@/lib/api/services";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/overlays";

/**
 * Hands an accepted idea to the EXISTING research workflow without changing it: it creates a normal new workspace
 * whose note carries the idea (and re-attaches the same arXiv paper when known). The researcher then starts the run
 * from that workspace like any other.
 */
export function HandoffButton({ title, text, arxivId }: { title: string; text: string; arxivId?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ws = await workspaceApi.create({ title: `Experiment: ${title}`.slice(0, 120), compute_budget: "quick", note: `Idea to test (from the Research Gap Explorer):\n\n${text}`.slice(0, 2000) });
      if (arxivId) {
        try { await workspaceApi.upload(ws.id, { kind: "paper", url: `arXiv:${arxivId}` }); } catch { /* the workspace still exists; the paper can be added there */ }
      }
      toast.success("New workspace created", "Start the run when ready.");
      router.push(`/workspaces/${ws.id}`);
    } catch (e) {
      toast.error("Couldn't hand this off", userMessage(e));
      setBusy(false);
    }
  };
  return <Button size="sm" variant="purple" loading={busy} onClick={() => void go()}><Flask size={14} /> Test in new workspace</Button>;
}
