"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api/services";
import { isApiError, userMessage } from "@/lib/api/errors";
import { qk } from "@/lib/hooks/queries";
import { safeReturnPath } from "@/lib/utils";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

/**
 * The Go backend finishes OAuth at GET /auth/github/callback, sets the session cookie, and
 * redirects here with ?status=success|error|cancelled&return_to=/path (proposed, see notes).
 * We never trust the query alone: success is confirmed by calling GET /me.
 */
function CallbackInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const status = sp.get("status");
    const returnTo = safeReturnPath(sp.get("return_to"));
    if (status === "cancelled" || sp.get("error") === "access_denied") {
      router.replace(`/login?reason=cancelled&return_to=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (status === "error" || sp.get("error")) {
      router.replace(`/login?reason=error&return_to=${encodeURIComponent(returnTo)}`);
      return;
    }
    const ac = new AbortController();
    authApi
      .me(ac.signal)
      .then((me) => {
        qc.setQueryData(qk.me, me);
        router.replace(returnTo);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (isApiError(e) && e.kind === "unauthorized") router.replace(`/login?reason=error&return_to=${encodeURIComponent(returnTo)}`);
        else setError(userMessage(e));
      });
    return () => ac.abort();
  }, [sp, router, qc]);

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-[28px] border-2 border-ink bg-white p-8 text-center shadow-pop-lg">
        <div className="flex justify-center"><Logo /></div>
        {error ? (
          <>
            <p className="mt-6 font-display text-lg font-bold">Couldn&apos;t confirm your sign-in</p>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <Button className="mt-5" onClick={() => router.replace("/login")}>Back to login</Button>
          </>
        ) : (
          <>
            <div className="mx-auto mt-8 h-2.5 w-40 overflow-hidden rounded-full bg-ink/10"><div className="skeleton h-full w-full" /></div>
            <p className="mt-4 text-sm font-semibold" role="status">Confirming your sign-in…</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <React.Suspense>
      <CallbackInner />
    </React.Suspense>
  );
}
