"use client";

import * as React from "react";
import { Check, MagnifyingGlass, PencilSimple, Prohibit, X } from "@phosphor-icons/react";
import type { XFeedback } from "@/lib/explorer/types";
import { Button } from "@/components/ui/button";
import { Badge, Textarea } from "@/components/ui/primitives";

const LABEL: Record<XFeedback["decision"], { text: string; tone: "mint" | "pink" | "sun" | "sky" | "lavender" }> = {
  accepted: { text: "Accepted", tone: "mint" },
  rejected: { text: "Rejected", tone: "pink" },
  edited: { text: "Edited by you", tone: "sun" },
  investigate: { text: "Further investigation requested", tone: "sky" },
  added: { text: "Your idea", tone: "lavender" },
};

type Save = (b: { decision: Exclude<XFeedback["decision"], "added">; reason?: string; edited?: Record<string, string> }) => void;

/**
 * Researcher feedback on one gap or recommendation: accept, reject (optional reason), refine the text, or ask for more
 * investigation. Saved on the server in the Explorer's own table, so it survives a refresh and is never lost.
 */
export function FeedbackBar({ mine, canEdit, busy, editableText, editKey, onSave, onClear }: {
  mine?: XFeedback; canEdit: boolean; busy: boolean; editableText?: string; editKey?: string; onSave: Save; onClear: (id: string) => void;
}) {
  const [mode, setMode] = React.useState<"idle" | "reject" | "edit">("idle");
  const [reason, setReason] = React.useState("");
  const [text, setText] = React.useState("");
  const save: Save = (b) => { onSave(b); setMode("idle"); setReason(""); };

  return (
    <div className="space-y-2 border-t border-line-cool pt-3" aria-label="Your feedback">
      {mine && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={LABEL[mine.decision].tone} solid>{LABEL[mine.decision].text}</Badge>
          {mine.reason && <span className="text-xs text-ink-soft">“{mine.reason}”</span>}
          {canEdit && <button type="button" disabled={busy} onClick={() => onClear(mine.id)} className="text-xs font-semibold text-purple-deep underline">Undo</button>}
        </div>
      )}
      {mine?.decision === "edited" && mine.edited[editKey ?? "improvement"] && <p className="rounded-lg bg-warning-soft p-2 text-sm"><b>Your refined version:</b> {mine.edited[editKey ?? "improvement"]}</p>}
      {!canEdit ? <p className="text-xs text-muted">View-only access: only an owner or editor can give feedback.</p> : mode === "idle" ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => save({ decision: "accepted" })}><Check size={14} weight="bold" /> Accept</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("reject")}><Prohibit size={14} /> Reject</Button>
          {editableText != null && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setText(mine?.edited[editKey ?? "improvement"] ?? editableText); setMode("edit"); }}><PencilSimple size={14} /> Edit</Button>}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => save({ decision: "investigate" })}><MagnifyingGlass size={14} /> Investigate further</Button>
        </div>
      ) : mode === "reject" ? (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold">Why are you rejecting it? (optional)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="mt-1 min-h-16 text-sm" /></label>
          <div className="flex gap-1.5"><Button size="sm" variant="danger" loading={busy} onClick={() => save({ decision: "rejected", reason })}>Reject</Button><Button size="sm" variant="ghost" onClick={() => setMode("idle")}><X size={14} /> Cancel</Button></div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold">Refine this suggestion
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} className="mt-1 min-h-24 text-sm" /></label>
          <div className="flex gap-1.5"><Button size="sm" variant="success" loading={busy} disabled={!text.trim()} onClick={() => save({ decision: "edited", edited: { [editKey ?? "improvement"]: text.trim() } })}>Save my version</Button><Button size="sm" variant="ghost" onClick={() => setMode("idle")}><X size={14} /> Cancel</Button></div>
        </div>
      )}
    </div>
  );
}
