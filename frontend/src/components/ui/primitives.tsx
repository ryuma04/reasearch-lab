import * as React from "react";
import { cn } from "@/lib/utils";

/* ── Tones (DESIGN.md §3.2 triad) ── */
export type Tone = "purple" | "lavender" | "sun" | "coral" | "mint" | "sky" | "pink" | "cream" | "ink" | "faint";

export const toneSolid: Record<Tone, string> = {
  purple: "bg-purple text-white", lavender: "bg-lavender text-ink", sun: "bg-sun text-ink", coral: "bg-coral text-white",
  mint: "bg-mint text-ink", sky: "bg-sky text-ink", pink: "bg-pink text-ink", cream: "bg-cream text-ink", ink: "bg-pill text-white", faint: "bg-ink/10 text-ink-soft",
};
export const toneSoft: Record<Tone, string> = {
  purple: "bg-lavender-soft text-purple-deep", lavender: "bg-lavender-soft text-purple-deep", sun: "bg-sun-soft text-sun-deep",
  coral: "bg-coral-soft text-coral-deep", mint: "bg-mint-soft text-mint-deep", sky: "bg-sky-soft text-sky-deep",
  pink: "bg-pink-soft text-pink-deep", cream: "bg-cream text-sun-deep", ink: "bg-ink/5 text-ink", faint: "bg-ink/5 text-muted",
};

/* ── Card (§9) ── */
type CardVariant = "clay" | "bento" | "sticker" | "soft" | "flat";
const cardClass: Record<CardVariant, string> = {
  clay: "bg-white shadow-clay rounded-[28px]",
  bento: "bg-white border border-line-cool shadow-soft rounded-2xl",
  sticker: "bg-white border-2 border-ink shadow-pop-lg rounded-[24px]",
  soft: "rounded-[24px]",
  flat: "bg-white rounded-2xl border border-line",
};

export function Card({
  variant = "clay", tone, interactive, className, ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; tone?: Tone; interactive?: boolean }) {
  return (
    <div
      className={cn(
        cardClass[variant],
        variant === "soft" && tone && toneSoft[tone],
        interactive && "cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-clay-lg",
        className,
      )}
      {...props}
    />
  );
}

/* ── Badge / pill ── */
export function Badge({ tone = "faint", solid, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; solid?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold leading-none tracking-[0.03em]", solid ? toneSolid[tone] : toneSoft[tone], className)}
      {...props}
    />
  );
}

/** Tilted sticker kicker (§17.1). */
export function Kicker({ children, tone = "sun", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex -rotate-1 items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] shadow-pop", toneSolid[tone], className)}>
      {children}
    </span>
  );
}

/** Marker highlight behind a phrase (pink, per the requested reference). */
export function Highlighter({ children, tone = "pink" }: { children: React.ReactNode; tone?: "pink" | "sun" | "lavender" }) {
  const bg = { pink: "bg-pink", sun: "bg-sun", lavender: "bg-lavender" }[tone];
  return (
    <span className="relative inline-block">
      <span className="relative z-10">{children}</span>
      <span className={cn("absolute inset-x-[-0.12em] bottom-[0.08em] top-[0.18em] z-0 -rotate-[0.6deg] rounded-[0.18em]", bg)} aria-hidden />
    </span>
  );
}

/* ── Status dot ── */
export function StatusDot({ tone, pulse }: { tone: "faint" | "sky" | "mint" | "sun" | "pink" | "purple"; pulse?: boolean }) {
  const c = { faint: "bg-faint", sky: "bg-info", mint: "bg-success", sun: "bg-warning", pink: "bg-danger", purple: "bg-purple" }[tone];
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden>
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", c)} />}
      <span className={cn("relative h-2.5 w-2.5 rounded-full", c)} />
    </span>
  );
}

/* ── Progress (only rendered when the backend gives a real value) ── */
export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={cn("h-2.5 w-full overflow-hidden rounded-full bg-ink/10 shadow-inner", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-gradient-to-r from-lavender to-purple transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ── Forms (§10) ── */
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn("text-sm font-semibold text-ink", className)} {...p} />
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn("h-12 w-full rounded-2xl border-2 border-transparent bg-white px-4 text-[15px] shadow-clay-sm outline-none placeholder:text-faint focus:border-purple aria-[invalid=true]:border-danger disabled:opacity-60", className)}
    {...p}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn("min-h-28 w-full resize-none rounded-2xl border-2 border-transparent bg-white px-4 py-3 text-[15px] shadow-clay-sm outline-none placeholder:text-faint focus:border-purple aria-[invalid=true]:border-danger", className)}
    {...p}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-11 w-full appearance-none rounded-2xl border-2 border-transparent bg-white bg-[length:12px] bg-[right_14px_center] bg-no-repeat px-4 pr-9 text-sm shadow-clay-sm outline-none focus:border-purple",
      "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 256 256%22><path fill=%22%231c1b2b%22 d=%22M213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32Z%22/></svg>')]",
      className,
    )}
    {...p}
  />
));
Select.displayName = "Select";

export function Field({ label, htmlFor, error, hint, children, required }: { label: string; htmlFor: string; error?: string | null; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label} {required ? <span className="text-coral-deep">*</span> : <span className="text-xs font-medium text-muted">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs font-semibold text-danger" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* ── Selection chip (§10.3) ── */
export function Chip({ selected, tone = "sun", className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; tone?: Tone }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-all active:scale-95",
        selected ? cn(toneSolid[tone], "text-ink ring-2 ring-ink shadow-pop") : "bg-white text-ink-soft shadow-clay-sm hover:-translate-y-0.5",
        className,
      )}
      {...p}
    >
      {children}
    </button>
  );
}

/* ── 3D clay ArtTile (§12.2) ── */
export function ArtTile({ children, tone = "lavender", size = 48 }: { children: React.ReactNode; tone?: Tone; size?: number }) {
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[30%] shadow-clay-sm", toneSoft[tone])} style={{ width: size, height: size }} aria-hidden>
      <span className="absolute inset-x-1 top-0.5 h-1/2 rounded-full bg-white/45 blur-[2px]" />
      <span className="relative drop-shadow-[0_2px_0_rgba(255,255,255,0.6)]">{children}</span>
    </span>
  );
}

/* ── Stat card (§17.2) ── */
export function StatCard({ label, value, hint, icon, tone = "lavender" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-[24px] bg-white p-4 shadow-clay-sm sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-muted">{label}</span>
        {icon && <ArtTile tone={tone} size={34}>{icon}</ArtTile>}
      </div>
      <div className="tabular mt-2 font-display text-2xl font-extrabold leading-none sm:text-[28px]">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ kicker, title, action, className }: { kicker?: string; title: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        {kicker && <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">{kicker}</p>}
        <h2 className="mt-1 text-xl font-bold sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <code className={cn("rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[12px] text-ink", className)}>{children}</code>;
}
