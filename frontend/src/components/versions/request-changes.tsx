"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilLine } from "@phosphor-icons/react";
import { versionApi } from "@/lib/api/services";
import { isApiError, userMessage } from "@/lib/api/errors";
import { qk } from "@/lib/hooks/queries";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/primitives";
import { Sheet, toast } from "@/components/ui/overlays";

const MAX = 4000;

/** Mirrors the server's check so an obviously empty or too-short request is explained before it is sent. */
export function changeRequestProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Describe what you want to change.";
  if (t.split(/\s+/).length < 3) return "Please describe the change in a few words, for example what should be different and why.";
  if (t.length > MAX) return `The request is too long (limit ${MAX} characters).`;
  return null;
}

/** "Request Changes": plain-English input that creates a new version; the original is never overwritten. */
export function RequestChanges({ runId, workspaceId }: { runId: string; workspaceId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const problem = changeRequestProblem(text);
  const submit = useMutation({
    mutationFn: () => versionApi.requestChange(runId, text.trim()),
    onSuccess: async (r) => {
      setOpen(false);
      setText("");
      setTouched(false);
      await qc.invalidateQueries({ queryKey: qk.versions(runId) });
      await qc.invalidateQueries({ queryKey: qk.workspace(workspaceId) });
      toast.success(r.created ? "New version created" : "This request already created a version", "Review its revised plan before any code is written.");
      router.push(`/workspaces/${workspaceId}/run/${r.new_run_id}`);
    },
  });
  const serverMessage = submit.error ? (isApiError(submit.error) && submit.error.message && submit.error.message !== submit.error.kind ? submit.error.message : userMessage(submit.error)) : null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { submit.reset(); setOpen(true); }}><PencilLine size={15} /> Request Changes</Button>
      <Sheet open={open} onOpenChange={(o) => !submit.isPending && setOpen(o)} mode="center" title="Request changes"
        description="Tell us in your own words what to change. This creates a new version; the current one stays exactly as it is.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!problem) submit.mutate(); }} noValidate>
          <label className="block text-sm font-semibold" htmlFor="change-request-text">What would you like to change?</label>
          <Textarea id="change-request-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX + 200} className="min-h-40 text-sm"
            aria-invalid={touched && !!problem} aria-describedby="change-help"
            placeholder="Describe what you want to change. You can request a different architecture, new functionality, code improvements, additional tests, or changes to the research approach." />
          <p id="change-help" className="text-xs text-muted">The agents analyze your request, reuse research that is still valid, write a revised plan for you to approve, then code and test it in the new version only. {text.length}/{MAX}</p>
          {touched && problem && <p role="alert" className="text-sm font-semibold text-danger">{problem}</p>}
          {serverMessage && <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm font-semibold text-danger">{serverMessage}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={submit.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="purple" loading={submit.isPending}>Analyze Changes</Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
