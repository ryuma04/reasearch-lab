"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster } from "@/components/ui/overlays";
import { shouldRetry } from "@/lib/hooks/queries";
import { USE_MOCKS } from "@/lib/config";
import { Flask } from "@phosphor-icons/react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 15_000 },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider delayDuration={150}>
        {USE_MOCKS && <DemoBanner />}
        {children}
        <Toaster />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}

/** Always visible while the dev-only demo transport is active. */
function DemoBanner() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b-2 border-ink bg-sun px-3 py-1.5 text-center text-xs font-bold text-ink">
      <Flask size={14} weight="bold" />
      DEMO DATA — development mock backend (NEXT_PUBLIC_USE_MOCKS). Nothing shown is a real run or a real GitHub push.
    </div>
  );
}
