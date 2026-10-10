import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ href = "/", className, light }: { href?: string; className?: string; light?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 rounded-full", className)} aria-label="Research Lab home">
      <span className="grid h-9 w-9 -rotate-6 place-items-center rounded-[30%] border-2 border-ink bg-sun font-display text-lg font-bold shadow-pop" aria-hidden>
        R
      </span>
      <span className={cn("whitespace-nowrap font-display text-lg font-bold tracking-tight", light ? "text-white" : "text-ink")}>Research Lab</span>
    </Link>
  );
}
