"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { GithubLogo, ShieldCheck, Warning, CheckCircle } from "@phosphor-icons/react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Badge, Highlighter } from "@/components/ui/primitives";
import { authApi, githubLoginUrl } from "@/lib/api/services";
import { EMAIL_LOGIN, USE_MOCKS } from "@/lib/config";
import { safeReturnPath } from "@/lib/utils";

const REASONS: Record<string, { tone: "warning" | "info" | "error"; text: string }> = {
  session: { tone: "warning", text: "Your session has expired or you are not signed in. Please continue with GitHub." },
  signed_out: { tone: "info", text: "You have been signed out." },
  cancelled: { tone: "info", text: "GitHub sign-in was cancelled. You can try again whenever you're ready." },
  error: { tone: "error", text: "GitHub sign-in failed. Please try again." },
};

function LoginInner() {
  const sp = useSearchParams();
  const returnTo = safeReturnPath(sp.get("return_to"));
  const reason = sp.get("reason") ?? (sp.get("error") ? "error" : null);
  const msg = reason ? REASONS[reason] ?? REASONS.error : null;
  const [redirecting, setRedirecting] = React.useState(false);

  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<"signin" | "register">("signin");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const emailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setLoginError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setLoginError("Password must be at least 6 characters.");
      return;
    }
    setRedirecting(true);
    try {
      if (mode === "register") await authApi.register(email.trim(), password, name.trim() || undefined);
      else await authApi.passwordLogin(email.trim(), password);
      window.location.assign(`/auth/callback?status=success&return_to=${encodeURIComponent(returnTo)}`);
    } catch (err) {
      setRedirecting(false);
      setLoginError(err instanceof Error ? err.message : "Sign-in failed");
    }
  };

  const start = () => {
    setRedirecting(true);
    if (USE_MOCKS) {
      sessionStorage.removeItem("demo_logged_out");
      window.location.assign(`/auth/callback?status=success&return_to=${encodeURIComponent(returnTo)}`);
      return;
    }
    // Full-page navigation: the Go backend runs the OAuth dance and sets the session cookie.
    window.location.assign(githubLoginUrl(returnTo));
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden border-r-2 border-ink bg-lavender p-10 lg:flex lg:flex-col">
        <Logo />
        <div className="relative mt-16 flex-1">
          <div className="w-80 -rotate-2 rounded-[24px] border-2 border-ink bg-white p-5 shadow-pop-lg">
            <Badge tone="mint" solid>Match</Badge>
            <p className="mt-3 text-sm font-bold">Small model alone</p>
            <p className="tabular mt-1 font-display text-3xl font-bold">151 <span className="text-base text-muted">vs 146</span></p>
            <p className="mt-2 font-mono text-[11px] text-muted">run #7 · log line 201</p>
          </div>
          <div className="ml-28 mt-6 w-72 rotate-[5deg] rounded-[24px] border-2 border-ink bg-sun p-5 shadow-pop-lg animate-float">
            <p className="text-xs font-bold uppercase tracking-[0.14em]">Coding Agent</p>
            <p className="mt-2 text-sm font-semibold">Fixed from memory: pinned numpy&lt;2 — learned in an earlier run.</p>
          </div>
          <p className="absolute bottom-0 text-xs text-ink-soft">Illustrations — not live data.</p>
        </div>
      </aside>

      <main className="flex items-center px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-md py-8">
          <div className="lg:hidden"><Logo /></div>
          <h1 className="mt-10 text-4xl font-normal leading-tight lg:mt-0">Welcome to your <Highlighter>research lab</Highlighter>.</h1>
          <p className="mt-4 text-ink-soft">Sign in with your email and password, or with GitHub. GitHub also connects the repository where your code, results and logs are pushed — only after you approve (you can connect it later from your profile).</p>

          {msg && (
            <div role={msg.tone === "error" ? "alert" : "status"} className={`mt-6 flex items-start gap-2 rounded-2xl p-3 text-sm font-medium ${msg.tone === "error" ? "bg-danger-soft text-danger" : msg.tone === "warning" ? "bg-warning-soft text-warning" : "bg-info-soft text-info"}`}>
              {msg.tone === "info" ? <CheckCircle size={18} className="mt-0.5 shrink-0" /> : <Warning size={18} className="mt-0.5 shrink-0" />}
              <span>{msg.text}{sp.get("error_description") ? ` (${sp.get("error_description")})` : ""}</span>
            </div>
          )}

          {EMAIL_LOGIN && (
            <form onSubmit={emailLogin} className="mt-8 space-y-3" noValidate>
              <label className="block text-sm font-semibold">Email
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-normal" placeholder="you@example.com" />
              </label>
              {mode === "register" && (
                <label className="block text-sm font-semibold">Name <span className="font-normal text-muted">(optional)</span>
                  <input autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-normal" placeholder="Your name" />
                </label>
              )}
              <label className="block text-sm font-semibold">Password
                <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={6} maxLength={200}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-normal" placeholder={mode === "register" ? "At least 6 characters" : "Your password"} />
              </label>
              {loginError && <p role="alert" className="text-sm text-danger">{loginError}</p>}
              <Button type="submit" size="lg" className="w-full" loading={redirecting}>{mode === "register" ? "Create account" : "Sign in"}</Button>
              <p className="text-center text-sm">
                {mode === "register" ? "Already have an account? " : "New here? "}
                <button type="button" className="font-semibold text-purple-deep underline underline-offset-2"
                  onClick={() => { setMode(mode === "register" ? "signin" : "register"); setLoginError(null); }}>
                  {mode === "register" ? "Sign in" : "Create an account"}
                </button>
              </p>
              <p className="text-center text-xs text-muted">or</p>
            </form>
          )}

          <Button size="lg" variant={EMAIL_LOGIN ? "outline" : "primary"} className={EMAIL_LOGIN ? "mt-3 w-full" : "mt-8 w-full"} onClick={start} loading={redirecting}>
            {!redirecting && <GithubLogo size={20} weight="bold" />} {redirecting ? "Redirecting to GitHub…" : "Continue with GitHub"}
          </Button>


          <ul className="mt-8 space-y-2 text-sm text-muted">
            <li className="flex gap-2"><ShieldCheck size={18} className="shrink-0 text-success" /> Your GitHub token is encrypted on our server and never sent to the browser.</li>
            <li className="flex gap-2"><ShieldCheck size={18} className="shrink-0 text-success" /> We ask for profile, email and repository access — you can disconnect anytime.</li>
          </ul>
          <p className="mt-10 text-sm"><Link href="/" className="font-semibold text-purple-deep underline underline-offset-2">← Back to home</Link></p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <LoginInner />
    </React.Suspense>
  );
}
