import Link from "next/link";
import {
  ArrowRight, Brain, ChartBar, CheckCircle, Detective, FileMagnifyingGlass, GitBranch, GithubLogo, Lightning,
  MapTrifold, Microphone, Play, SealCheck, ShieldCheck, TreeStructure, UsersThree, Cpu, Scales,
} from "@phosphor-icons/react/ssr";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { ArtTile, Badge, Highlighter, Kicker, type Tone } from "@/components/ui/primitives";

const STEPS = [
  { n: "01", title: "Give it a paper", body: "Upload a PDF or paste an arXiv link. Dataset, repo and a note are optional.", Icon: FileMagnifyingGlass, tone: "lavender" },
  { n: "02", title: "Approve the plan", body: "The Research Agent extracts every claim with its page. You approve, edit or reject the plan.", Icon: MapTrifold, tone: "sun" },
  { n: "03", title: "Watch it reproduce", body: "Code is written, run and repaired inside a locked-down sandbox — live, with a reason for every step.", Icon: Cpu, tone: "sky" },
  { n: "04", title: "Get proof, not prose", body: "A claim-by-claim scorecard, a tested explanation of every gap, what-if branches, and a GitHub push.", Icon: SealCheck, tone: "mint" },
] as const;

const FEATURES: { title: string; body: string; Icon: typeof Brain; tone: Tone }[] = [
  { title: "Claim Scorecard", body: "Paper vs. measured, Match / Close / Different, with the page and the log line behind each number.", Icon: ChartBar, tone: "purple" },
  { title: "No number without proof", body: "The AI never types a result. Every value comes from metrics.json written by code that actually ran.", Icon: ShieldCheck, tone: "mint" },
  { title: "Gap Detective", body: "When numbers differ, it runs small experiments to find out why — and says so in plain words.", Icon: Detective, tone: "coral" },
  { title: "What-if branches", body: "Ask “what if T=5?” — branches run in parallel; weak ones stop early with successive halving.", Icon: TreeStructure, tone: "sky" },
  { title: "Fixed, explainable pipeline", body: "Research → plan approval → Coding → Testing → Gap Detective, plus What-If branches. Same order every run, every step visible.", Icon: UsersThree, tone: "lavender" },
  { title: "Lab Memory", body: "Errors, fixes and settings are remembered, so the next run is faster and makes fewer mistakes.", Icon: Brain, tone: "sun" },
  { title: "Live Research Map", body: "The Observer draws what each agent found and did: paper, claims, sources, code and tests.", Icon: MapTrifold, tone: "pink" },
  { title: "Control from your phone", body: "Large approve / reject buttons on mobile, a shared live link with QR code, and run replay.", Icon: Microphone, tone: "cream" },
];

const MARQUEE = ["Distillation · Hinton 2015", "Lottery Ticket Hypothesis", "KAN", "TabPFN vs trees", "PointNet", "Physics-informed NNs", "CGCNN", "Grokking", "MobileNetV2"];

export default function LandingPage() {
  return (
    <div className="bg-dots">
      <header className="sticky top-0 z-40 border-b border-ink/5 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 rounded-full bg-white p-1 shadow-clay-sm md:flex" aria-label="Sections">
            {[["#how", "How it works"], ["#features", "Features"], ["#proof", "Proof"]].map(([h, l]) => (
              <a key={h} href={h} className="inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold text-ink-soft hover:bg-canvas hover:text-ink">{l}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/login">Log in</Link></Button>
            <Button asChild size="sm"><Link href="/login?return_to=%2Fworkspaces%2Fnew">Get started <ArrowRight size={16} weight="bold" /></Link></Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:pb-24 lg:pt-20">
          <div>
            <Kicker><Lightning size={14} weight="fill" /> Evolving AI research environment</Kicker>
            <h1 className="mt-6 text-[2.6rem] font-normal leading-[1.05] tracking-[-0.02em] sm:text-5xl lg:text-[4.1rem]">
              Give your papers a re-run. Meet your new <Highlighter>AI research team</Highlighter>.
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-soft sm:text-lg">
              Upload a machine-learning paper. A team of agents reproduces its key result on a laptop CPU, tests it against the paper&apos;s own numbers, explains every difference, and explores your “what if?” questions — then pushes everything to your GitHub.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="purple"><Link href="/login?return_to=%2Fworkspaces%2Fnew"><GithubLogo size={20} weight="bold" /> Continue with GitHub</Link></Button>
              <Button asChild size="lg" variant="outline"><a href="#how"><Play size={20} weight="bold" /> See how it works</a></Button>
            </div>
            <ul className="mt-8 grid gap-3 text-sm font-semibold text-ink-soft sm:grid-cols-3">
              {[["Every number has proof", ShieldCheck, "mint"], ["Runs on modest compute", Cpu, "sky"], ["You approve each step", CheckCircle, "sun"]].map(([t, I, tone]) => {
                const Icon = I as typeof ShieldCheck;
                return (
                  <li key={t as string} className="flex items-center gap-2">
                    <ArtTile tone={tone as Tone} size={34}><Icon size={18} weight="duotone" /></ArtTile>{t as string}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Showcase card (illustrative product preview, not live data) */}
          <div className="relative">
            <span className="absolute -right-2 -top-6 z-10 rotate-12 rounded-full border-2 border-ink bg-coral px-4 py-2 font-display text-lg font-bold text-white shadow-pop animate-wiggle">PROOF!</span>
            <div className="rounded-[32px] border-2 border-ink bg-white p-5 shadow-pop-lg sm:p-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Claim Scorecard</p>
                <Badge tone="faint">Illustration</Badge>
              </div>
              <div className="mt-4 space-y-2.5">
                {[["Teacher model", "67", "70", "Match", "mint"], ["Small model alone", "146", "151", "Match", "mint"], ["Distilled, T = 20", "74", "81", "Close", "sun"]].map(([n, p, o, s, t]) => (
                  <div key={n} className="flex items-center gap-3 rounded-2xl bg-canvas px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{n}</span>
                    <span className="tabular w-10 text-right text-sm text-muted">{p}</span>
                    <span className="tabular w-10 text-right font-display text-sm font-bold">{o}</span>
                    <Badge tone={t as Tone} solid>{s}</Badge>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border-2 border-dashed border-line p-3 font-mono text-[12px] text-ink-soft">
                from run #7 · commit a1b2c3 · log line 214
              </div>
              <div className="mt-4 rounded-2xl bg-lavender-soft p-3 text-sm text-purple-deep">
                <b>Gap Detective:</b> training longer closed 4 of the 7-error gap; input jitter closed 2 more.
              </div>
            </div>
          </div>
        </section>

        {/* Marquee */}
        <section aria-label="Example papers" className="overflow-hidden border-y-2 border-ink bg-white py-4">
          <div className="flex w-max animate-marquee gap-4">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={i} className="whitespace-nowrap rounded-[28px] border-2 border-ink bg-canvas px-5 py-2 text-sm font-semibold shadow-pop">{m}</span>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">How it works</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-semibold sm:text-[2.5rem] sm:leading-[1.1]">From PDF to proven result, with you in control.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ n, title, body, Icon, tone }) => (
              <div key={n} className="relative overflow-hidden rounded-[28px] bg-white p-6 shadow-clay">
                <span className="absolute right-4 top-2 font-display text-6xl font-bold text-ink/5" aria-hidden>{n}</span>
                <ArtTile tone={tone} size={52}><Icon size={28} weight="duotone" /></ArtTile>
                <h3 className="mt-5 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Dark showcase: the control room */}
        <section className="bg-ink py-20 text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <Kicker tone="lavender">Not a chat app</Kicker>
              <h2 className="mt-5 text-3xl font-semibold sm:text-[2.5rem] sm:leading-[1.1]">A research control room.</h2>
              <p className="mt-4 text-white/75">Every agent is a card with what it is doing right now, <em>why</em> it is doing it, and what it has cost. Pause, stop, retry or give an instruction — at any step.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Research", "Plan approval", "Coding", "Testing", "What-ifs", "Push"].map((s, i) => (
                  <span key={s} className={i < 3 ? "rounded-full border-2 border-white bg-purple px-3 py-1 text-xs font-bold" : "rounded-full border-2 border-white/30 px-3 py-1 text-xs font-bold text-white/60"}>{s}</span>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[["Gap Detective", "Testing: 5 epochs vs the paper's longer run", "One-change experiment, not a guess", "bg-lavender"], ["Coding · Debugger", "Pinned numpy<2 — fixed from memory", "Same error seen in run #3", "bg-mint"], ["Research · Reader", "Reading page 3: MNIST results", "LaTeX source avoids OCR errors", "bg-sky"], ["Testing · Runner", "6 / 6 tests passed", "Claims checked with ±10% tolerance", "bg-sun"]].map(([a, t, w, c]) => (
                <div key={a} className="rounded-[24px] border-2 border-white/80 bg-white p-4 text-ink shadow-[5px_5px_0_#7b5cf0]">
                  <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full border border-ink ${c}`} /><span className="text-xs font-bold uppercase tracking-wider text-muted">{a}</span></div>
                  <p className="mt-2 text-sm font-bold">{t}</p>
                  <p className="mt-1 text-xs text-muted">Why: {w}</p>
                </div>
              ))}
              <p className="text-xs text-white/50 sm:col-span-2">Illustrative example of the Live Agent Board.</p>
            </div>
          </div>
        </section>

        {/* Two personas */}
        <section className="mx-auto grid max-w-6xl gap-5 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div className="rounded-[32px] bg-white p-7 shadow-clay sm:p-9">
            <Badge tone="sun" solid>You, the researcher</Badge>
            <h3 className="mt-4 text-2xl font-semibold">Decide, don&apos;t babysit.</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-ink-soft">
              {["Upload a paper — everything else is optional", "Approve the plan at Checkpoint 1", "Ask what-if questions from your phone", "Approve the GitHub push at Checkpoint 2"].map((x) => (
                <li key={x} className="flex gap-2"><CheckCircle size={18} weight="fill" className="shrink-0 text-success" />{x}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line-cool bg-white p-7 shadow-soft sm:p-9">
            <Badge tone="sky">The agent team</Badge>
            <h3 className="mt-4 text-2xl font-semibold">Does the machinery.</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-ink-soft">
              {["Reads the paper, finds code and data", "Writes, runs and repairs code in a sandbox", "Tests every claim; investigates every gap", "Remembers fixes; scores and evolves itself"].map((x) => (
                <li key={x} className="flex gap-2"><GitBranch size={18} weight="duotone" className="shrink-0 text-sky-deep" />{x}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Feature bento */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">Features</p>
          <h2 className="mt-2 text-3xl font-semibold sm:text-[2.5rem]">Built for trust.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ title, body, Icon, tone }) => (
              <div key={title} className="rounded-[28px] bg-white p-6 shadow-clay transition-all duration-200 hover:-translate-y-1 hover:shadow-clay-lg">
                <ArtTile tone={tone} size={48}><Icon size={26} weight="duotone" /></ArtTile>
                <h3 className="mt-4 text-base font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section id="proof" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20 sm:px-6">
          <div className="grid gap-8 rounded-[40px] bg-white p-8 shadow-clay sm:p-12 lg:grid-cols-2">
            <div>
              <Kicker tone="mint"><Scales size={14} weight="bold" /> Our rule</Kicker>
              <h2 className="mt-5 text-3xl font-semibold">The AI is never allowed to write a result number.</h2>
              <p className="mt-4 text-ink-soft">Results come only from files written by sandboxed code. Each one links to the exact page in the paper and the exact run, commit and log line that produced it. Missing evidence is shown as missing — never filled in.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[["70%", "of researchers have failed to reproduce another scientist's experiment (Nature survey)"], ["6%", "of 400 top-AI-conference papers shared their code (Science)"], ["42%", "of one AI-scientist's experiments failed from coding errors"], ["₹0", "to run: free models, laptop CPU, free Kaggle/Colab"]].map(([v, l]) => (
                <div key={v} className="rounded-[24px] bg-canvas p-5">
                  <p className="tabular font-display text-3xl font-bold">{v}</p>
                  <p className="mt-1 text-xs text-muted">{l}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="bg-speed relative overflow-hidden rounded-[32px] border-2 border-ink bg-sun p-8 text-center shadow-pop-lg sm:p-14">
            <h2 className="text-3xl font-semibold sm:text-[2.5rem]">Reproduce your first paper today.</h2>
            <p className="mx-auto mt-3 max-w-lg text-ink-soft">Log in with GitHub — that also connects the repository where your results will land.</p>
            <Button asChild size="lg" className="mt-7"><Link href="/login?return_to=%2Fworkspaces%2Fnew"><GithubLogo size={20} weight="bold" /> Continue with GitHub</Link></Button>
          </div>
        </section>
      </main>

      <footer className="relative overflow-hidden bg-ink pb-10 pt-14 text-white">
        <span className="pointer-events-none absolute -bottom-[4vw] left-0 select-none whitespace-nowrap font-display text-[18vw] font-bold leading-none text-white/5" aria-hidden>Research Lab</span>
        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo light />
          <nav className="flex flex-wrap gap-4 text-sm text-white/70" aria-label="Footer">
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#features" className="hover:text-white">Features</a>
            <Link href="/login" className="hover:text-white">Log in</Link>
          </nav>
          <p className="text-xs text-white/50">Problem Statement 03 · An Evolving AI Research Environment</p>
        </div>
      </footer>
    </div>
  );
}
