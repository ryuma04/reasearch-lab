"use client";

import * as React from "react";
import { CheckCircle, Hourglass, Lock, MinusCircle, Prohibit, SpinnerGap, XCircle } from "@phosphor-icons/react";
import type { StageInfo, StageKey, StageStatus } from "@/lib/workflow/state";
import { cn } from "@/lib/utils";

const ICON: Record<StageStatus, { Icon: React.ElementType; cls: string; spin?: boolean }> = {
  pending: { Icon: Lock, cls: "text-muted" },
  active: { Icon: SpinnerGap, cls: "text-sky-deep", spin: true },
  awaiting: { Icon: Hourglass, cls: "text-purple-deep" },
  done: { Icon: CheckCircle, cls: "text-success" },
  failed: { Icon: XCircle, cls: "text-danger" },
  stopped: { Icon: Prohibit, cls: "text-muted" },
  skipped: { Icon: MinusCircle, cls: "text-muted" },
};

const SR: Record<StageStatus, string> = {
  pending: "not started", active: "in progress", awaiting: "waiting for you", done: "done", failed: "failed", stopped: "stopped", skipped: "not needed",
};

/** The persistent stage progression. Locked stages cannot be opened until their prerequisites are met. */
export function StageNav({ stages, view, current, onSelect }: { stages: StageInfo[]; view: StageKey; current: StageKey; onSelect: (k: StageKey) => void }) {
  return (
    <nav aria-label="Workflow stages" className="-mx-1 overflow-x-auto pb-1">
      <ol className="flex min-w-max items-stretch gap-1.5 px-1">
        {stages.map((s, i) => {
          const m = ICON[s.status];
          const on = view === s.key;
          return (
            <li key={s.key} className="flex items-center gap-1.5">
              <button
                type="button" disabled={!s.canOpen} onClick={() => onSelect(s.key)} aria-current={on ? "step" : undefined}
                title={s.reason} aria-label={`${s.label}: ${SR[s.status]}. ${s.reason}`}
                className={cn(
                  "flex items-center gap-2 rounded-2xl border-2 px-3.5 py-2 text-left transition-all",
                  on ? "border-ink bg-pill text-white shadow-pop" : "border-line bg-white hover:-translate-y-0.5",
                  s.key === current && !on && "border-purple",
                  !s.canOpen && "cursor-not-allowed opacity-55 hover:translate-y-0",
                )}
              >
                <m.Icon size={20} weight={s.status === "done" || s.status === "failed" ? "fill" : "bold"} className={cn(on ? "text-white" : m.cls, m.spin && "animate-spin")} />
                <span>
                  <span className="block text-sm font-bold leading-tight">{s.label}</span>
                  <span className={cn("block text-[11px] leading-tight", on ? "text-white/70" : "text-muted")}>{SR[s.status]}</span>
                </span>
              </button>
              {i < stages.length - 1 && <span aria-hidden className={cn("h-0.5 w-4 rounded", s.status === "done" || s.status === "skipped" ? "bg-success" : "bg-line")} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
