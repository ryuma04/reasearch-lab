import { cn } from "@/lib/utils";

/** Small spinner for a task that is genuinely running. It is only rendered while the backend says "running". */
export function Spinner({ className }: { className?: string }) {
  return <span role="img" aria-label="Running" className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-sky-deep border-r-transparent", className)} />;
}
