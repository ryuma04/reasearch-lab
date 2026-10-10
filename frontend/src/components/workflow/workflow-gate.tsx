"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { isApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/hooks/queries";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Logo } from "@/components/shell/logo";

/** Client-side sign-in gate (the backend still authorises every call). Returns to this exact run after login. */
export function WorkflowGate({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const unauthorized = isApiError(me.error) && me.error.kind === "unauthorized";
  React.useEffect(() => {
    if (unauthorized) {
      const rt = window.location.pathname + window.location.search;
      router.replace(`/login?return_to=${encodeURIComponent(rt)}&reason=session`);
    }
  }, [unauthorized, router, pathname]);

  return (
    <div className="min-h-dvh bg-dots-cool">
      <div className="border-b border-ink/5 bg-canvas-cool/85 px-4 py-2 backdrop-blur-md sm:px-6"><Logo href="/dashboard" /></div>
      {me.isPending || unauthorized ? <div className="mx-auto max-w-5xl space-y-4 p-6"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>
        : me.error ? <div className="mx-auto max-w-2xl p-6"><ErrorState error={me.error} title="Can't load your session" onRetry={() => void me.refetch()} /></div>
        : children}
    </div>
  );
}
