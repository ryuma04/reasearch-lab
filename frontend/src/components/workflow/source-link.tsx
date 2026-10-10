"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import { safeUrl, sourceActionLabel, type SourceKind } from "@/lib/sources";
import { cn } from "@/lib/utils";

/**
 * "Open paper ↗" etc. Renders only when the agents really reported a valid http(s) URL: a title is never turned
 * into a guessed link. Opens in a new tab and never starts a graph drag or selection.
 */
export function SourceLink({ url, kind, className, label }: { url: unknown; kind: SourceKind; className?: string; label?: string }) {
  const href = safeUrl(url);
  if (!href) return null;
  return (
    <a
      href={href} target="_blank" rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-1 text-xs font-semibold text-purple-deep underline underline-offset-2 hover:text-purple", className)}
    >
      {label ?? sourceActionLabel(kind)}
      <ArrowSquareOut size={12} aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** A source title that links out when it has a valid URL, plain text otherwise. */
export function SourceTitle({ title, url, className }: { title: string; url: unknown; className?: string }) {
  const href = safeUrl(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cn("font-semibold underline underline-offset-2 hover:text-purple-deep", className)}>
      {title}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : <span className={cn("font-semibold", className)}>{title}</span>;
}
