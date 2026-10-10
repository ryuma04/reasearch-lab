"use client";

import * as React from "react";
import { ArrowClockwise, PlugsConnected, Ghost, WarningCircle, LockKey } from "@phosphor-icons/react";
import { isApiError, userMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { ArtTile, Mono } from "./primitives";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-2xl", className)} aria-hidden />;
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-20" />)}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-[28px] bg-white/60 p-8 text-center sm:p-14">
      <div className="mx-auto mb-4 w-fit animate-float">
        <ArtTile tone="lavender" size={64}>{icon ?? <Ghost size={34} weight="duotone" className="text-purple-deep" />}</ArtTile>
      </div>
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Shown when a (proposed) backend route is not implemented yet — never replaced by fake data. */
export function EndpointUnavailable({ error, feature }: { error: unknown; feature: string }) {
  const ep = isApiError(error) ? error.endpoint : null;
  return (
    <div className="rounded-[28px] border-2 border-dashed border-sky-deep/30 bg-sky-soft/50 px-6 py-8 text-center" role="status">
      <div className="mx-auto mb-3 w-fit"><ArtTile tone="sky" size={52}><PlugsConnected size={28} weight="duotone" className="text-sky-deep" /></ArtTile></div>
      <h3 className="font-display text-base font-bold">{feature}: backend endpoint not available yet</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
        The frontend is wired and waiting. {ep && <>Expected <Mono>{ep.method} {ep.template}</Mono>{ep.status === "proposed" ? " (proposed contract — see FRONTEND_INTEGRATION_NOTES.md)" : ""}.</>}
      </p>
    </div>
  );
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  if (isApiError(error) && error.kind === "unavailable") return <EndpointUnavailable error={error} feature={title ?? "This view"} />;
  const forbidden = isApiError(error) && error.kind === "forbidden";
  return (
    <div role="alert" className="rounded-[28px] border-2 border-dashed border-danger/30 bg-danger-soft/40 px-6 py-10 text-center">
      <div className="mx-auto mb-3 w-fit">
        <ArtTile tone="pink" size={52}>
          {forbidden ? <LockKey size={28} weight="duotone" className="text-pink-deep" /> : <WarningCircle size={28} weight="duotone" className="text-pink-deep" />}
        </ArtTile>
      </div>
      <h3 className="font-display text-base font-bold">{title ?? (forbidden ? "Permission denied" : "Something went wrong")}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">{userMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <ArrowClockwise size={16} weight="bold" /> Retry
        </Button>
      )}
    </div>
  );
}

/** Standard loading / error / empty switch for a query. */
export function QueryView<T>({
  query, feature, empty, isEmpty, children, skeleton,
}: {
  query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
  feature: string;
  empty?: React.ReactNode;
  isEmpty?: (d: T) => boolean;
  skeleton?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <SkeletonList />}</>;
  if (query.error) return <ErrorState error={query.error} title={feature} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return null;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children(query.data)}</>;
}
