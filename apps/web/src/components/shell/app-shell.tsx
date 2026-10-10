"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Brain, GithubLogo, House, Plus, SignOut, SquaresFour, User, UsersThree } from "@phosphor-icons/react";
import { isApiError } from "@/lib/api/errors";
import { authApi } from "@/lib/api/services";
import { useMe } from "@/lib/hooks/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { toast } from "@/components/ui/overlays";
import { Logo } from "./logo";

const NAV = [
  { href: "/dashboard", label: "Lab", Icon: SquaresFour },
  { href: "/team", label: "Team", Icon: UsersThree },
  { href: "/memory", label: "Memory", Icon: Brain },
  { href: "/profile", label: "Profile", Icon: User },
];

/** Operator console shell (§6.2.2) + client-side auth gate (backend still authorises every call). */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();

  React.useEffect(() => {
    if (isApiError(me.error) && me.error.kind === "unauthorized") {
      const rt = typeof window !== "undefined" ? window.location.pathname + window.location.search : pathname;
      router.replace(`/login?return_to=${encodeURIComponent(rt)}&reason=session`);
    }
  }, [me.error, pathname, router]);

  const active = (href: string) => pathname === href || pathname.startsWith(href + "/") || (href === "/dashboard" && pathname.startsWith("/workspaces"));

  return (
    <div className="min-h-dvh bg-dots-cool pb-28 md:pb-10">
      <header className="sticky top-0 z-40 border-b border-ink/5 bg-canvas-cool/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo href="/dashboard" />
          <nav className="hidden items-center gap-1 rounded-full bg-white p-1 shadow-clay-sm md:flex" aria-label="Main">
            {NAV.map(({ href, label, Icon }) => {
              const on = active(href);
              return (
                <Link key={href} href={href} aria-current={on ? "page" : undefined}
                  className={cn("relative inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors", on ? "text-white" : "text-ink-soft hover:text-ink")}>
                  {on && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-pill" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                  <Icon size={18} weight={on ? "fill" : "regular"} className="relative" />
                  <span className="relative">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="purple" className="hidden sm:inline-flex">
              <Link href="/workspaces/new"><Plus size={16} weight="bold" /> New workspace</Link>
            </Button>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {me.isPending ? (
          <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>
        ) : me.error && !(isApiError(me.error) && me.error.kind === "unauthorized") ? (
          <ErrorState error={me.error} title="Can't load your session" onRetry={() => void me.refetch()} />
        ) : me.data ? (
          children
        ) : (
          <Skeleton className="h-48" />
        )}
      </main>

      <nav className="fixed inset-x-3 bottom-3 z-40 rounded-[28px] border-2 border-ink bg-white/95 px-2 py-1.5 shadow-pop backdrop-blur md:hidden" aria-label="Main mobile">
        <ul className="flex items-center justify-around">
          {[{ href: "/dashboard", label: "Lab", Icon: House }, { href: "/workspaces/new", label: "New", Icon: Plus }, ...NAV.slice(1)].map(({ href, label, Icon }) => {
            const on = href === "/workspaces/new" ? pathname === href : active(href);
            return (
              <li key={href}>
                <Link href={href} className="flex min-w-14 flex-col items-center gap-0.5 rounded-2xl px-2 py-1" aria-current={on ? "page" : undefined}>
                  <span className={cn("grid h-9 w-12 place-items-center rounded-full transition-colors", on ? "bg-pill text-white" : "text-ink-soft")}>
                    <Icon size={20} weight={on ? "fill" : "regular"} />
                  </span>
                  <span className={cn("text-[10px] font-semibold", on ? "text-ink" : "text-muted")}>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function Avatar({ src, name, size = 36 }: { src: string | null | undefined; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="rounded-full border-2 border-ink object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid place-items-center rounded-full border-2 border-ink bg-lavender font-display text-sm font-bold" style={{ width: size, height: size }} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function UserMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  if (!me.data) return <Skeleton className="h-10 w-10 rounded-full" />;
  const { user, github } = me.data;

  const logout = async () => {
    setBusy(true);
    try {
      await authApi.logout();
      qc.clear();
      router.replace("/login?reason=signed_out");
    } catch (e) {
      if (isApiError(e) && e.kind === "unavailable") toast.warning("Sign-out endpoint not available", "POST /auth/logout is proposed — ask the backend to add it.");
      else toast.error("Couldn't sign out", isApiError(e) ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="rounded-full" aria-label="Account menu">
        <Avatar src={user.avatar_url} name={user.name ?? user.github_username} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="z-50 w-64 rounded-[22px] border-2 border-ink bg-white p-2 shadow-pop-lg">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-bold">{user.name ?? user.github_username}</p>
            <p className="flex items-center gap-1 truncate text-xs text-muted"><GithubLogo size={12} /> @{user.github_username} · {github.status === "connected" ? "connected" : "not connected"}</p>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.Item asChild><Link href="/profile" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold outline-none data-[highlighted]:bg-canvas"><User size={16} /> Profile & GitHub</Link></Dropdown.Item>
          <Dropdown.Item asChild><Link href="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold outline-none data-[highlighted]:bg-canvas"><House size={16} /> Home page</Link></Dropdown.Item>
          <Dropdown.Item disabled={busy} onSelect={(e) => { e.preventDefault(); void logout(); }} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-danger outline-none data-[highlighted]:bg-danger-soft">
            <SignOut size={16} /> Sign out
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
