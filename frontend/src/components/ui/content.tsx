"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { safeUrl } from "@/lib/sources";

/** Safe Markdown: react-markdown never renders raw HTML (no rehype-raw), links open safely. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-lab", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ href, children: c }) => (safeUrl(href) ? <a href={safeUrl(href)!} target="_blank" rel="noopener noreferrer nofollow">{c}</a> : <span>{c}</span>) }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />} {done ? "Copied" : label}
    </button>
  );
}

/** Plain-text code/log viewer with line numbers. Content is untrusted: rendered as text only. */
export function CodeViewer({ code, title, actions, highlightLine, maxHeight = "28rem" }: { code: string; title?: string; actions?: React.ReactNode; highlightLine?: number | null; maxHeight?: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className="overflow-hidden rounded-[22px] border-2 border-ink bg-pill shadow-pop">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <span className="truncate font-mono text-xs text-white/80">{title}</span>
        <div className="flex items-center gap-1.5">{actions}<CopyButton text={code} /></div>
      </div>
      <pre className="overflow-auto py-3 text-[12.5px] leading-6 text-white" style={{ maxHeight }}>
        <code>
          {lines.map((l, i) => (
            <div key={i} className={cn("flex px-4", highlightLine === i + 1 && "bg-sun/25")}>
              <span className="w-10 shrink-0 select-none pr-3 text-right text-white/35">{i + 1}</span>
              <span className="whitespace-pre">{l || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
