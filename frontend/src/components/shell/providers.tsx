"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider, type Query } from "@tanstack/react-query";
import { PersistQueryClientProvider, removeOldestQuery } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster } from "@/components/ui/overlays";
import { shouldRetry } from "@/lib/hooks/queries";
import { USE_MOCKS } from "@/lib/config";
import { Flask } from "@phosphor-icons/react";

/* ── Tab cache ──
 * Successful queries are saved to localStorage, so a new tab, a refresh or the tab opened by "Create & run" paints
 * at once from the last known data and refreshes it in the background (stale-while-revalidate). Large or fast-moving
 * data (event streams, file contents, logs) is not saved. Sign-out clears the cache (queryClient.clear()). */
const CACHE_KEY = "research-lab-cache";
const CACHE_VERSION = "1"; // bump when a cached response shape changes
const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const NOT_CACHED = ["events", "stream", "file", "logs", "replay", "execution", "explainer", "assistant"];

function browserStorage(): Storage | undefined {
  try {
    const s = window.localStorage;
    s.setItem(`${CACHE_KEY}-probe`, "1");
    s.removeItem(`${CACHE_KEY}-probe`);
    return s;
  } catch {
    return undefined; // private mode / blocked storage: the app works without the cache
  }
}

const cacheable = (q: Query) =>
  q.state.status === "success" && !q.queryKey.some((k) => typeof k === "string" && NOT_CACHED.some((n) => k.toLowerCase().includes(n)));

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // gcTime >= the cache's max age, so restored entries are not dropped before they are used
          queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 15_000, gcTime: CACHE_MAX_AGE },
          mutations: { retry: false },
        },
      }),
  );
  const [persister] = React.useState(() => {
    if (typeof window === "undefined" || USE_MOCKS) return undefined;
    const storage = browserStorage();
    return storage ? createSyncStoragePersister({ storage, key: CACHE_KEY, throttleTime: 800, retry: removeOldestQuery }) : undefined;
  });
  const inner = (
    <Tooltip.Provider delayDuration={150}>
      {USE_MOCKS && <DemoBanner />}
      {children}
      <Toaster />
    </Tooltip.Provider>
  );
  if (!persister) return <QueryClientProvider client={client}>{inner}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider client={client}
      persistOptions={{ persister, maxAge: CACHE_MAX_AGE, buster: CACHE_VERSION, dehydrateOptions: { shouldDehydrateQuery: cacheable } }}>
      {inner}
    </PersistQueryClientProvider>
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
