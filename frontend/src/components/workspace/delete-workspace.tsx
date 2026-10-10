"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash } from "@phosphor-icons/react";
import { workspaceApi } from "@/lib/api/services";
import { isApiError, userMessage } from "@/lib/api/errors";
import { qk } from "@/lib/hooks/queries";
import { Button } from "@/components/ui/button";
import { Sheet, toast } from "@/components/ui/overlays";

/**
 * Permanently deletes one workspace after a confirmation. The server only lets the owner do it and refuses
 * while a run is still executing; its message is shown as it is so the researcher knows what to do.
 */
export function DeleteWorkspaceButton({ id, title, variant = "icon", onDeleted, className }: {
  id: string; title: string; variant?: "icon" | "button"; onDeleted?: () => void; className?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const del = useMutation({
    mutationFn: () => workspaceApi.remove(id),
    onSuccess: async () => {
      setOpen(false);
      qc.removeQueries({ queryKey: qk.workspace(id) });
      await qc.invalidateQueries({ queryKey: qk.workspaces });
      toast.success("Workspace deleted", `“${title}” and its data were removed.`);
      onDeleted?.();
    },
  });
  const message = del.error ? (isApiError(del.error) && del.error.message && del.error.message !== del.error.kind ? del.error.message : userMessage(del.error)) : null;

  return (
    <>
      {variant === "icon" ? (
        <button type="button" aria-label={`Delete workspace ${title}`} title="Delete workspace" onClick={() => { del.reset(); setOpen(true); }}
          className={`grid h-9 w-9 place-items-center rounded-full bg-white text-ink-soft shadow-clay-sm transition hover:bg-danger-soft hover:text-danger ${className ?? ""}`}>
          <Trash size={16} />
        </button>
      ) : (
        <Button size="sm" variant="outline" className={className} onClick={() => { del.reset(); setOpen(true); }}>
          <Trash size={14} /> Delete workspace
        </Button>
      )}
      <Sheet open={open} onOpenChange={(o) => !del.isPending && setOpen(o)} mode="center" title="Delete this workspace?"
        description={`“${title}” will be permanently deleted.`}>
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">This removes its papers, runs, results, logs and uploaded files. It cannot be undone. Anything already published to Hugging Face stays there.</p>
          {message && <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm font-semibold text-danger">{message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={del.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}><Trash size={16} /> Delete workspace</Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
