"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle, Info, Sparkle, Warning, WarningOctagon, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/* ── Adaptive Sheet (§11.2): bottom sheet on phones, side drawer / centered modal on ≥640px ── */
export function Sheet({
  open, onOpenChange, title, description, children, mode = "drawer", className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  mode?: "drawer" | "center";
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-[61] flex max-h-[92dvh] flex-col rounded-t-[32px] bg-canvas shadow-float outline-none",
            mode === "drawer"
              ? "sm:inset-x-auto sm:bottom-3 sm:right-3 sm:top-3 sm:max-h-none sm:w-[520px] sm:rounded-[32px]"
              : "sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[32px] sm:border-2 sm:border-ink sm:shadow-pop-lg",
            className,
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4 sm:px-6 sm:pt-6">
            <div>
              <Dialog.Title className="font-display text-lg font-bold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white shadow-clay-sm transition hover:rotate-90" aria-label="Close">
              <X size={18} weight="bold" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Toaster (§11.1) ── */
type ToastTone = "success" | "error" | "info" | "warning" | "ai";
interface ToastItem { id: number; tone: ToastTone; title: string; body?: string }

let pushToast: ((t: Omit<ToastItem, "id">) => void) | null = null;
let counter = 0;

export const toast = {
  success: (title: string, body?: string) => pushToast?.({ tone: "success", title, body }),
  error: (title: string, body?: string) => pushToast?.({ tone: "error", title, body }),
  info: (title: string, body?: string) => pushToast?.({ tone: "info", title, body }),
  warning: (title: string, body?: string) => pushToast?.({ tone: "warning", title, body }),
  ai: (title: string, body?: string) => pushToast?.({ tone: "ai", title, body }),
};

const toneMeta: Record<ToastTone, { bg: string; Icon: typeof Info }> = {
  success: { bg: "bg-mint", Icon: CheckCircle },
  error: { bg: "bg-pink", Icon: WarningOctagon },
  info: { bg: "bg-sky", Icon: Info },
  warning: { bg: "bg-sun", Icon: Warning },
  ai: { bg: "bg-lavender", Icon: Sparkle },
};

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    pushToast = (t) => {
      const id = ++counter;
      setItems((s) => [...s.slice(-3), { ...t, id }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 4500);
    };
    return () => { pushToast = null; };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-3 top-3 z-[90] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:top-4" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => {
          const { bg, Icon } = toneMeta[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[22px] border-2 border-ink bg-white p-3 pr-2 shadow-pop-lg"
              role={t.tone === "error" ? "alert" : "status"}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-ink", bg)}><Icon size={18} weight="bold" /></span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm font-bold">{t.title}</p>
                {t.body && <p className="mt-0.5 break-words text-xs text-ink-soft">{t.body}</p>}
              </div>
              <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-ink/5" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} aria-label="Dismiss">
                <X size={14} weight="bold" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
