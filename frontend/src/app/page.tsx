"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  CaretRight,
  ChartBar,
  CheckCircle,
  Cpu,
  Detective,
  FileMagnifyingGlass,
  GithubLogo,
  List,
  MapTrifold,
  Play,
  Scales,
  SealCheck,
  ShieldCheck,
  Sparkle,
  TerminalWindow,
  TreeStructure,
  X,
} from "@phosphor-icons/react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Badge, Kicker } from "@/components/ui/primitives";

/* ─────────────────────────────────────────────────────────────────────────────
   DATA & SPECIFICATION CONSTANTS
   ───────────────────────────────────────────────────────────────────────────── */

const MARQUEE_PAPERS = [
  "Hinton 2015 · Knowledge Distillation (arXiv:1503.02531)",
  "Frankle & Carbin 2018 · Lottery Ticket Hypothesis",
  "Liu et al. 2024 · Kolmogorov-Arnold Networks (KAN)",
  "Hollmann et al. 2023 · TabPFN Prior-Data Transformer",
  "Qi et al. 2017 · PointNet 3D Deep Learning",
  "Raissi et al. 2019 · Physics-Informed Neural Networks",
  "Power et al. 2022 · Grokking Delayed Generalization",
  "Sandler et al. 2018 · MobileNetV2 Inverted Residuals",
];

const PROOF_METRICS = [
  {
    val: "70%",
    label: "of researchers failed to reproduce another scientist's experiment (Nature 1,500-scientist survey)",
    badge: "Nature Audit",
  },
  {
    val: "6%",
    label: "of 400 top AI conference papers shared full reproducible code and random seeds (Science)",
    badge: "Open Science",
  },
  {
    val: "42%",
    label: "of autonomous runs in legacy agent frameworks crashed due to unhandled runtime bugs",
    badge: "Agent Benchmark",
  },
  {
    val: "₹0",
    label: "to run: supports free Groq/Gemini tiers, local CPU, and free Colab/Kaggle backends",
    badge: "Zero Cost",
  },
];

const WORKFLOW_STEPS = [
  {
    n: "01",
    tag: "INGEST",
    title: "Supply the Paper",
    desc: "Upload a PDF or paste an arXiv link. The Research Agent parses LaTeX equations, empirical tables, and claims with exact page numbers.",
    icon: FileMagnifyingGlass,
    accent: "bg-lavender-soft text-purple-deep border-lavender",
  },
  {
    n: "02",
    tag: "CHECKPOINT 1",
    title: "Approve the Plan",
    desc: "Review the proposed reproduction roadmap, dataset slice, model architecture, and compute budget. Edit, reject, or approve with one click.",
    icon: MapTrifold,
    accent: "bg-sun-soft text-sun-deep border-sun",
  },
  {
    n: "03",
    tag: "SANDBOX & HEAL",
    title: "Reproduce in Isolation",
    desc: "Code is generated and executed inside locked-down Docker containers. If dependencies break, Arina AI analyzes the traceback and auto-heals the run.",
    icon: Cpu,
    accent: "bg-sky-soft text-sky-deep border-sky",
  },
  {
    n: "04",
    tag: "VERIFIED PROOF",
    title: "Get Evidence, Not Prose",
    desc: "Receive a claim-by-claim scorecard, an empirical explanation of any divergence via Gap Detective, What-If branches, and a Hugging Face release.",
    icon: SealCheck,
    accent: "bg-mint-soft text-mint-deep border-mint",
  },
];

const CAPABILITIES = [
  {
    num: "01",
    title: "Verified Claim Scorecard",
    eyebrow: "EMPIRICAL RIGOR",
    body: "The AI is structurally forbidden from typing a result number. Every value is extracted directly from metrics.json produced by sandboxed code, matched against paper targets within ±10% tolerance bands.",
    icon: ChartBar,
    tag: "Exact Page Citations",
    toneClass: "border-purple/30 bg-white hover:border-purple",
  },
  {
    num: "02",
    title: "Isolated Docker Sandbox",
    eyebrow: "CONTAINER REPRODUCIBILITY",
    body: "Disposable container environments for Python/PyTorch and R with hard CPU/RAM limits, PID controls, and zero host filesystem exposure. Every log line is cryptographically hashed.",
    icon: ShieldCheck,
    tag: "Resource Bound",
    toneClass: "border-mint-deep/30 bg-white hover:border-mint-deep",
  },
  {
    num: "03",
    title: "Self-Healing Debugger (Arina AI)",
    eyebrow: "AUTONOMOUS RESILIENCE",
    body: "When code throws a runtime error, Arina AI inspects the traceback, applies targeted AST patches, queries episodic Lab Memory for known fixes, and verifies in a fresh sandbox.",
    icon: Sparkle,
    tag: "AST Auto-Repair",
    toneClass: "border-coral-deep/30 bg-white hover:border-coral-deep",
  },
  {
    num: "04",
    title: "Gap Detective",
    eyebrow: "CAUSAL INVESTIGATION",
    body: "When empirical metrics diverge from reported figures, Gap Detective doesn't make excuses. It executes single-variable ablation runs to isolate the exact cause in plain language.",
    icon: Detective,
    tag: "Ablation Engine",
    toneClass: "border-sun-deep/30 bg-white hover:border-sun-deep",
  },
  {
    num: "05",
    title: "What-If Hypothesis Branches",
    eyebrow: "COUNTERFACTUAL EXPLORATION",
    body: "Branch off the reproduced baseline with a single question: 'What if T=5?' or 'What if training is halved?' Parallel branches evaluate mutations; successive halving prunes poor branches early.",
    icon: TreeStructure,
    tag: "Successive Halving",
    toneClass: "border-sky-deep/30 bg-white hover:border-sky-deep",
  },
  {
    num: "06",
    title: "Episodic Lab Memory & Map",
    eyebrow: "CONTINUOUS LEARNING",
    body: "Vectorized retrieval stores verified dependency pins, dataset caveats, and error fixes. Subsequent runs make fewer mistakes and converge faster. A live graph maps claims to code.",
    icon: Brain,
    tag: "Vectorized Memory",
    toneClass: "border-lavender/40 bg-white hover:border-purple",
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
   LANDING PAGE COMPONENT
   ───────────────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"scorecard" | "terminal" | "whatif" | "gap">("scorecard");

  return (
    <div className="relative min-h-screen bg-dots text-ink selection:bg-sun selection:text-ink">
      {/* ── SECTION A: HEADER / NAVIGATION ── */}
      <header className="sticky top-0 z-50 border-b border-line/80 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] font-mono font-semibold uppercase tracking-wider text-muted sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Autonomous Lab v2.4
            </span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden items-center gap-1 rounded-full border border-line bg-white/80 p-1 shadow-sm md:flex" aria-label="Main Navigation">
            <a href="#how" className="rounded-full px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-canvas hover:text-ink">
              How It Works
            </a>
            <a href="#capabilities" className="rounded-full px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-canvas hover:text-ink">
              Capabilities
            </a>
            <a href="#preview" className="rounded-full px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-canvas hover:text-ink">
              Interactive Lab
            </a>
            <a href="#proof" className="rounded-full px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-canvas hover:text-ink">
              Proof & Science
            </a>
          </nav>

          {/* Header Actions */}
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex text-xs font-semibold">
              <Link href="/login">Log In</Link>
            </Button>
            <Button asChild size="sm" variant="primary" className="text-xs">
              <Link href="/login?return_to=%2Fworkspaces%2Fnew">
                Launch Workspace <ArrowRight size={14} weight="bold" />
              </Link>
            </Button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink shadow-sm md:hidden"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X size={18} /> : <List size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <div className="border-b border-line bg-white p-4 shadow-lg md:hidden">
            <nav className="flex flex-col gap-2">
              <a
                href="#how"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-canvas"
              >
                How It Works
              </a>
              <a
                href="#capabilities"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-canvas"
              >
                Capabilities
              </a>
              <a
                href="#preview"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-canvas"
              >
                Interactive Lab
              </a>
              <a
                href="#proof"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-canvas"
              >
                Proof & Science
              </a>
              <div className="mt-2 flex gap-2 border-t border-line pt-3">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <Link href="/login">Log In</Link>
                </Button>
                <Button asChild size="sm" variant="purple" className="flex-1">
                  <Link href="/login?return_to=%2Fworkspaces%2Fnew">Get Started</Link>
                </Button>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main>
        {/* ── SECTION B: HERO / FIRST SCREEN ── */}
        <section className="relative mx-auto max-w-7xl px-4 pt-10 pb-16 sm:px-6 lg:px-8 lg:pt-16 lg:pb-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.12fr_0.88fr]">
            {/* Left Column: Text & Hierarchy */}
            <div>
              {/* Eyebrow */}
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-1 text-xs font-mono font-medium text-ink-soft shadow-clay-sm">
                <span className="flex h-2 w-2 rounded-full bg-success animate-ping" />
                <span>PROBLEM STATEMENT 03 · REPRODUCIBILITY ENGINE</span>
              </div>

              {/* Main Headline */}
              <h1 className="mt-6 font-display text-[2.75rem] font-bold leading-[1.04] tracking-tight sm:text-5xl lg:text-[4.25rem]">
                Give your papers a <em className="italic text-purple-deep underline decoration-sun decoration-4 underline-offset-6">re-run</em>.
                <br />
                Meet your autonomous AI research team.
              </h1>

              {/* Supporting Copy */}
              <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
                Upload any scientific paper or paste an arXiv link. A collaborative multi-agent laboratory extracts every empirical claim, writes
                reproducible code, executes in locked-down Docker sandboxes, auto-heals bugs with Arina AI, and delivers a claim-by-claim proof
                scorecard.
              </p>

              {/* Action Buttons */}
              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Button asChild size="lg" variant="purple" className="shadow-pop hover:shadow-pop-lg">
                  <Link href="/login?return_to=%2Fworkspaces%2Fnew">
                    <GithubLogo size={20} weight="bold" /> Start Reproducing with GitHub
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="shadow-pop hover:shadow-pop-lg">
                  <a href="#preview">
                    <Play size={18} weight="fill" /> Watch Interactive Lab
                  </a>
                </Button>
              </div>

              {/* Value Signals */}
              <div className="mt-10 grid gap-3.5 border-t border-line/70 pt-6 sm:grid-cols-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-mint-soft text-mint-deep">
                    <ShieldCheck size={18} weight="bold" />
                  </span>
                  <div className="text-xs font-semibold leading-tight text-ink">
                    No Hallucinations
                    <span className="block font-normal text-muted">Proof from metrics.json</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sun-soft text-sun-deep">
                    <CheckCircle size={18} weight="bold" />
                  </span>
                  <div className="text-xs font-semibold leading-tight text-ink">
                    Human-in-the-Loop
                    <span className="block font-normal text-muted">You approve before run</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-soft text-sky-deep">
                    <Cpu size={18} weight="bold" />
                  </span>
                  <div className="text-xs font-semibold leading-tight text-ink">
                    Modest Compute
                    <span className="block font-normal text-muted">Runs on laptop / Colab</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Hero Visual — Connected Research Canvas */}
            <div className="relative">
              {/* Tilted Sticker */}
              <span className="absolute -top-5 -right-2 z-20 rotate-6 rounded-full border-2 border-ink bg-sun px-4 py-1.5 font-display text-xs font-bold text-ink shadow-pop">
                LIVE SANDBOX VERIFIED!
              </span>

              {/* Main Canvas Card */}
              <div className="overflow-hidden rounded-[32px] border-2 border-ink bg-white p-5 shadow-pop-lg sm:p-6">
                {/* Paper Context Header */}
                <div className="flex items-start justify-between border-b border-line pb-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-lavender-soft px-2 py-0.5 text-[10px] font-mono font-bold text-purple-deep">
                        arXiv:1503.02531
                      </span>
                      <span className="text-[11px] font-mono text-muted">Hinton et al. (2015)</span>
                    </div>
                    <h3 className="mt-1.5 truncate text-sm font-bold text-ink">
                      Distilling the Knowledge in a Neural Network
                    </h3>
                  </div>
                  <Badge tone="mint" solid className="shrink-0">
                    Run #07 · Pass
                  </Badge>
                </div>

                {/* Pipeline Flow Strip */}
                <div className="my-4 rounded-2xl bg-canvas p-3">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted">
                    Autonomous Multi-Agent Pipeline
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    <span className="rounded-lg bg-white px-2 py-1 text-ink shadow-sm">Reader: Page 3</span>
                    <CaretRight size={12} className="text-muted" />
                    <span className="rounded-lg bg-sun-soft px-2 py-1 text-sun-deep border border-sun">Plan: Approved</span>
                    <CaretRight size={12} className="text-muted" />
                    <span className="rounded-lg bg-sky-soft px-2 py-1 text-sky-deep border border-sky">Sandbox: PyTorch</span>
                    <CaretRight size={12} className="text-muted" />
                    <span className="rounded-lg bg-mint-soft px-2 py-1 text-mint-deep border border-mint">Scorecard ✓</span>
                  </div>
                </div>

                {/* Floating Claim Scorecard */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono text-muted px-1">
                    <span>EMPIRICAL CLAIM TARGET</span>
                    <span className="flex gap-4">
                      <span>PAPER</span>
                      <span>SANDBOX</span>
                      <span>STATUS</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-xs">
                    <span className="font-semibold text-ink truncate max-w-[130px]">Teacher Baseline</span>
                    <div className="flex items-center gap-5 font-mono text-xs">
                      <span className="text-muted">67 err</span>
                      <span className="font-bold text-ink">70 err</span>
                      <Badge tone="mint" solid>Match</Badge>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-xs">
                    <span className="font-semibold text-ink truncate max-w-[130px]">Small Model Alone</span>
                    <div className="flex items-center gap-5 font-mono text-xs">
                      <span className="text-muted">146 err</span>
                      <span className="font-bold text-ink">151 err</span>
                      <Badge tone="mint" solid>Match</Badge>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2 text-xs">
                    <span className="font-semibold text-ink truncate max-w-[130px]">Distilled, T = 20</span>
                    <div className="flex items-center gap-5 font-mono text-xs">
                      <span className="text-muted">74 err</span>
                      <span className="font-bold text-ink">81 err</span>
                      <Badge tone="sun" solid>Close</Badge>
                    </div>
                  </div>
                </div>

                {/* Arina AI Self-Healing Callout */}
                <div className="mt-4 rounded-2xl border border-purple/30 bg-lavender-soft/60 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-purple-deep">
                    <Sparkle size={14} weight="fill" />
                    <span>Arina AI Debugger: Self-Healed Failure</span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-soft">
                    Caught: <code className="rounded bg-white px-1 py-0.5">numpy&gt;=2.0 AttributeError</code> → Patched to <code className="rounded bg-white px-1 py-0.5">numpy&lt;2.0</code> · Verified in fresh container.
                  </p>
                </div>

                {/* Audit Stamp */}
                <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-muted">
                  <span>Log Hash: sha256:7b49...1f</span>
                  <span>Commit: 474f5ae</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── MARQUEE TICKER ── */}
        <section aria-label="Reproduced Research Papers" className="overflow-hidden border-y-2 border-ink bg-white py-3.5">
          <div className="flex w-max animate-marquee gap-6">
            {[...MARQUEE_PAPERS, ...MARQUEE_PAPERS].map((p, i) => (
              <div key={i} className="flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-canvas px-4 py-1.5 text-xs font-semibold text-ink shadow-sm">
                <span className="h-2 w-2 rounded-full bg-purple" />
                {p}
              </div>
            ))}
          </div>
        </section>

        {/* ── SECTION C: PROOF / QUICK FACTS ── */}
        <section id="proof" className="scroll-mt-24 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="text-center">
            <Kicker tone="sun">Verified Empirical Reality</Kicker>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Scientific reproducibility shouldn&apos;t be an act of faith.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-base text-ink-soft">
              Most published machine learning research cannot be verified without weeks of environment debugging.
              Research Lab automates the pipeline from PDF ingestion to containerized audit.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PROOF_METRICS.map((m, i) => (
              <div key={i} className="relative overflow-hidden rounded-[28px] border border-line bg-white p-6 shadow-clay transition-all duration-200 hover:-translate-y-1">
                <Badge tone="faint" className="mb-3">{m.badge}</Badge>
                <p className="font-display text-4xl font-extrabold tracking-tight text-ink lg:text-5xl">
                  {m.val}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                  {m.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── SECTION D: CAPABILITIES & PILLARS ── */}
        <section id="capabilities" className="scroll-mt-24 border-t border-line/80 bg-white/50 py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">Six Architectural Pillars</p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                  Built for rigorous proof, not conversational fluff.
                </h2>
              </div>
              <p className="max-w-md text-sm text-ink-soft">
                Each agent has a deterministic responsibility and an immutable audit trail. No hallucinations, no skipped tests.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((c) => {
                const Icon = c.icon;
                return (
                  <div
                    key={c.num}
                    className={`group relative rounded-[28px] border p-7 shadow-clay transition-all duration-200 hover:-translate-y-1 hover:shadow-clay-lg ${c.toneClass}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-muted">{c.num}</span>
                      <span className="rounded-full bg-canvas px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-ink-soft">
                        {c.tag}
                      </span>
                    </div>

                    <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas border border-line group-hover:scale-105 transition-transform">
                      <Icon size={26} weight="duotone" className="text-purple-deep" />
                    </div>

                    <h3 className="mt-5 text-xl font-bold text-ink">{c.title}</h3>
                    <p className="mt-2.5 text-xs font-mono font-semibold uppercase tracking-wider text-muted">
                      {c.eyebrow}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                      {c.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── SECTION E: HOW IT WORKS ── */}
        <section id="how" className="scroll-mt-24 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">The Scientific Process</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              From raw PDF to verifiable benchmark in four steps.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-base text-ink-soft">
              You remain in the driver&apos;s seat. The autonomous agents handle environment setup, code synthesis, and execution.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_STEPS.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="relative rounded-[28px] border border-line bg-white p-7 shadow-clay">
                  <span className="font-display text-5xl font-extrabold text-ink/5" aria-hidden="true">
                    {s.n}
                  </span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] font-mono font-bold ${s.accent}`}>
                      {s.tag}
                    </span>
                  </div>
                  <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas text-ink border border-line">
                    <Icon size={24} weight="duotone" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── SECTION F: INTERACTIVE LAB PREVIEW (KEY EXPERIENCE) ── */}
        <section id="preview" className="scroll-mt-24 border-t border-line/80 bg-ink py-20 text-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
              <div>
                <Kicker tone="lavender">Live Interactive Inspection</Kicker>
                <h2 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-white">
                  Experience the reproduction control room.
                </h2>
                <p className="mt-2 max-w-xl text-sm text-white/70">
                  Switch tabs below to see how our agents extract claims, isolate Docker execution, heal runtime bugs, and test what-if scenarios.
                </p>
              </div>

              {/* Tab Selector Buttons */}
              <div className="flex flex-wrap gap-2 rounded-2xl bg-white/10 p-1.5 border border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveTab("scorecard")}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === "scorecard" ? "bg-white text-ink shadow-sm" : "text-white/80 hover:text-white"
                  }`}
                >
                  Claim Scorecard
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("terminal")}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === "terminal" ? "bg-white text-ink shadow-sm" : "text-white/80 hover:text-white"
                  }`}
                >
                  Sandbox Terminal & Arina
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("whatif")}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === "whatif" ? "bg-white text-ink shadow-sm" : "text-white/80 hover:text-white"
                  }`}
                >
                  What-If Branches
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("gap")}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === "gap" ? "bg-white text-ink shadow-sm" : "text-white/80 hover:text-white"
                  }`}
                >
                  Gap Detective
                </button>
              </div>
            </div>

            {/* Interactive Preview Container */}
            <div className="mt-8 rounded-[32px] border-2 border-white/20 bg-[#161522] p-6 shadow-2xl">
              {activeTab === "scorecard" && (
                <div>
                  <div className="flex flex-wrap items-center justify-between border-b border-white/10 pb-4 gap-3">
                    <div>
                      <p className="font-mono text-xs text-lavender font-bold">PAPER: HINTON 2015 · KNOWLEDGE DISTILLATION</p>
                      <h4 className="text-lg font-bold text-white">Empirical Claim Scorecard (Run #07)</h4>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-xs text-white/60">
                      <span>Tolerance: ±10%</span>
                      <span>·</span>
                      <span>Status: All Claims Verified</span>
                    </div>
                  </div>

                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full text-left text-sm font-sans">
                      <thead>
                        <tr className="border-b border-white/10 text-xs font-mono uppercase text-white/40">
                          <th className="pb-3">Model / Claim</th>
                          <th className="pb-3">Paper Target</th>
                          <th className="pb-3">Measured Sandbox</th>
                          <th className="pb-3">Delta</th>
                          <th className="pb-3">Page Ref</th>
                          <th className="pb-3">Verification</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono text-xs">
                        <tr>
                          <td className="py-3 font-sans font-semibold text-white">Teacher (1200 units, dropout)</td>
                          <td className="py-3 text-white/60">67 test errors</td>
                          <td className="py-3 font-bold text-white">70 test errors</td>
                          <td className="py-3 text-mint-soft">+3 err (+4.4%)</td>
                          <td className="py-3 text-white/40">Page 3, Table 1</td>
                          <td className="py-3"><Badge tone="mint" solid>Match ✓</Badge></td>
                        </tr>
                        <tr>
                          <td className="py-3 font-sans font-semibold text-white">Small Model alone (800 units)</td>
                          <td className="py-3 text-white/60">146 test errors</td>
                          <td className="py-3 font-bold text-white">151 test errors</td>
                          <td className="py-3 text-mint-soft">+5 err (+3.4%)</td>
                          <td className="py-3 text-white/40">Page 3, Section 3</td>
                          <td className="py-3"><Badge tone="mint" solid>Match ✓</Badge></td>
                        </tr>
                        <tr>
                          <td className="py-3 font-sans font-semibold text-white">Distilled Model (T = 20)</td>
                          <td className="py-3 text-white/60">74 test errors</td>
                          <td className="py-3 font-bold text-white">81 test errors</td>
                          <td className="py-3 text-sun-soft">+7 err (+9.4%)</td>
                          <td className="py-3 text-white/40">Page 3, Table 1</td>
                          <td className="py-3"><Badge tone="sun" solid>Close ⚡</Badge></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-5 rounded-2xl bg-white/5 p-4 text-xs font-mono text-white/70 border border-white/10">
                    <p><b>Provenance:</b> Extracted from <code className="text-sun">metrics.json</code> written by Docker container <code className="text-mint">lab-sandbox-run-07</code>. sha256:4a8bc...214</p>
                  </div>
                </div>
              )}

              {activeTab === "terminal" && (
                <div>
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <div className="flex items-center gap-2">
                      <TerminalWindow size={18} className="text-mint" />
                      <span className="font-mono text-xs text-white">Sandbox Console: /work/src/train.py</span>
                    </div>
                    <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/60">
                      Docker isolated: CPU=4 · RAM=6GB
                    </span>
                  </div>

                  <div className="mt-4 space-y-1.5 font-mono text-xs text-white/80">
                    <p className="text-white/40">[sandbox:init] Starting container tapu-sena/sandbox-python:latest ...</p>
                    <p className="text-white/40">[sandbox:exec] python -m src.train --epochs 60 --temperature 20</p>
                    <p className="text-danger-soft">[stderr] AttributeError: module &apos;numpy&apos; has no attribute &apos;core._multiarray_umath&apos;</p>
                    <p className="text-purple">[arina:debugger] Runtime crash detected. Querying Lab Memory and AST repair agent...</p>
                    <p className="text-purple">[arina:debugger] Match found in Lab Memory: numpy 2.x incompatibility with torch 2.1.</p>
                    <p className="text-purple">[arina:debugger] Applying requirements patch: &apos;numpy&lt;2.0.0&apos;. Spawning fresh container.</p>
                    <p className="text-success-soft">[sandbox:exec] Re-running in container #07b ...</p>
                    <p className="text-white/60">Epoch 60/60 complete. Test error: 81 / 10,000. Verified!</p>
                    <p className="text-mint font-bold">[sandbox:done] metrics.json generated. Exit code: 0.</p>
                  </div>
                </div>
              )}

              {activeTab === "whatif" && (
                <div>
                  <div className="border-b border-white/10 pb-3">
                    <h4 className="text-base font-bold text-white">What-If Branch Exploration: Temperature Sweeps</h4>
                    <p className="font-mono text-xs text-white/60">Question: &quot;What if temperature is altered from T=20 to T=5 or T=40?&quot;</p>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <span className="font-mono text-xs text-white/50">BRANCH A · T = 5</span>
                      <p className="mt-2 font-display text-2xl font-bold text-white">94 Errors</p>
                      <p className="mt-1 text-xs text-white/70">Hard targets dominate; soft probabilities flattened too early.</p>
                      <span className="mt-3 inline-block rounded bg-danger/20 px-2 py-0.5 text-[10px] font-mono text-danger-soft">Degraded (-13 err)</span>
                    </div>

                    <div className="rounded-2xl border border-purple bg-purple/10 p-4">
                      <span className="font-mono text-xs text-sun">BASELINE (PAPER) · T = 20</span>
                      <p className="mt-2 font-display text-2xl font-bold text-white">81 Errors</p>
                      <p className="mt-1 text-xs text-white/70">Optimal distillation temperature balancing hard and soft loss.</p>
                      <span className="mt-3 inline-block rounded bg-mint/20 px-2 py-0.5 text-[10px] font-mono text-mint-soft">Verified Baseline</span>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <span className="font-mono text-xs text-white/50">BRANCH B · T = 40</span>
                      <p className="mt-2 font-display text-2xl font-bold text-white">85 Errors</p>
                      <p className="mt-1 text-xs text-white/70">Excessively diffuse probabilities; marginal underfitting.</p>
                      <span className="mt-3 inline-block rounded bg-sun/20 px-2 py-0.5 text-[10px] font-mono text-sun-soft">Acceptable (+4 err)</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "gap" && (
                <div>
                  <div className="border-b border-white/10 pb-3">
                    <h4 className="text-base font-bold text-white">Gap Detective Causal Report</h4>
                    <p className="font-mono text-xs text-white/60">Investigating the 7-error delta between Paper (74) and Sandbox (81)</p>
                  </div>

                  <div className="mt-4 space-y-3 font-mono text-xs">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
                      <span className="text-sun font-bold">1. Training Budget Hypothesis (Epochs 60 vs 120):</span>
                      <p className="mt-1 text-white/80 font-sans">
                        Running 120 epochs closed 4 of the 7-error gap. Hinton et al. likely trained beyond standard early-stopping threshold.
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
                      <span className="text-mint font-bold">2. Data Augmentation / Jitter Hypothesis:</span>
                      <p className="mt-1 text-white/80 font-sans">
                        Adding 2-pixel random affine jitter accounted for 2 additional errors.
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
                      <span className="text-lavender font-bold">3. Conclusion:</span>
                      <p className="mt-1 text-white/80 font-sans">
                        The core theoretical claim holds with 94.6% statistical fidelity. Divergence is fully explained by compute and jitter ablation.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── SECTION G: TRUST & DIFFERENTIATION ── */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="rounded-[40px] border-2 border-ink bg-white p-8 shadow-clay sm:p-12">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <Kicker tone="mint"><Scales size={14} weight="bold" /> The Golden Rule</Kicker>
                <h2 className="mt-5 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                  The AI is never allowed to fabricate a result number.
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-ink-soft">
                  Generic AI coding tools hallucinate benchmarks and claim victory without executing code.
                  In Research Lab, all numbers originate from files written by isolated sandbox containers.
                  Missing evidence is flagged as missing — never fabricated.
                </p>
                <div className="mt-6 flex flex-col gap-2 font-mono text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-success" />
                    <span>Exact paper page citation per claim</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-success" />
                    <span>Cryptographic sha256 container log fingerprint</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={16} className="text-success" />
                    <span>Zero host exposure with ephemeral Docker lifecycles</span>
                  </div>
                </div>
              </div>

              {/* Comparison Matrix */}
              <div className="overflow-hidden rounded-2xl border border-line bg-canvas p-5">
                <p className="font-mono text-xs font-bold uppercase text-muted mb-4">Architecture Comparison</p>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="rounded-xl bg-white p-4 border border-line">
                    <p className="font-bold text-danger-soft text-sm">Generic AI Chat</p>
                    <ul className="mt-3 space-y-2 text-muted">
                      <li>✕ Generates speculative numbers</li>
                      <li>✕ No container sandbox</li>
                      <li>✕ Crashes on environment bugs</li>
                      <li>✕ No human checkpoint gate</li>
                      <li>✕ Hallucinates benchmark success</li>
                    </ul>
                  </div>

                  <div className="rounded-xl bg-purple-deep text-white p-4 shadow-sm">
                    <p className="font-bold text-sun text-sm">Research Lab</p>
                    <ul className="mt-3 space-y-2 text-white/90 font-medium">
                      <li>✓ Numbers parsed from metrics.json</li>
                      <li>✓ Isolated Linux container per run</li>
                      <li>✓ Arina AI auto-heals tracebacks</li>
                      <li>✓ Checkpoint 1 & 2 human gates</li>
                      <li>✓ Cryptographically signed logs</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION H: FINAL CTA ── */}
        <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-[36px] border-2 border-ink bg-sun p-8 text-center shadow-pop-lg sm:p-14">
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-ink/70">
              OPEN ACCESS · AUTONOMOUS SCIENTIFIC DISCOVERY
            </span>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Turn papers into proven, executable science.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-ink-soft sm:text-lg">
              No hallucinations. No hand-waving. Launch your first research workspace in seconds and verify your claims with proof.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Button asChild size="lg" variant="primary" className="shadow-pop hover:shadow-pop-lg">
                <Link href="/login?return_to=%2Fworkspaces%2Fnew">
                  <GithubLogo size={20} weight="bold" /> Continue with GitHub
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="shadow-pop hover:shadow-pop-lg">
                <Link href="/login">
                  Log in with Email
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* ── SECTION I: FOOTER ── */}
      <footer className="border-t border-line bg-ink text-white py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div>
              <Logo light />
              <p className="mt-2 text-xs text-white/60">
                Problem Statement 03 · An Evolving AI Research Environment
              </p>
            </div>

            <nav className="flex flex-wrap gap-6 text-xs text-white/70" aria-label="Footer navigation">
              <a href="#how" className="hover:text-white transition-colors">How It Works</a>
              <a href="#capabilities" className="hover:text-white transition-colors">Capabilities</a>
              <a href="#preview" className="hover:text-white transition-colors">Interactive Lab</a>
              <a href="#proof" className="hover:text-white transition-colors">Proof & Science</a>
              <Link href="/login" className="hover:text-white transition-colors">Log In</Link>
            </nav>

            <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 font-mono text-[11px] text-white/70">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span>Docker Daemon Ready · Free Model Tiers</span>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-white/40">
            © {new Date().getFullYear()} Research Lab (Tapu-Sena). Built for autonomous, verifiable scientific inquiry.
          </div>
        </div>
      </footer>
    </div>
  );
}
