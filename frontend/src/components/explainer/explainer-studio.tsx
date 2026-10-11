"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  ArrowClockwise, CheckCircle, DownloadSimple, FilePdf, FilmSlate, Microphone, Quotes, Sparkle, Trash, UploadSimple, WarningCircle,
} from "@phosphor-icons/react";
import { explainerApi, workspaceApi } from "@/lib/api/services";
import { userMessage } from "@/lib/api/errors";
import type { ExplainerScene, ExplainerStatus, ExplainerVideo } from "@/lib/api/types";
import { qk, useExplainerVideo, useExplainerVideos, useExplainerVoices, useWorkspace } from "@/lib/hooks/queries";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Progress, SectionTitle, Select, type Tone } from "@/components/ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { toast } from "@/components/ui/overlays";

const STAGES: { key: ExplainerStatus; label: string; hint: string }[] = [
  { key: "extracting", label: "Read the paper", hint: "Text, figures, tables and equations" },
  { key: "scripting", label: "Write the script", hint: "Fact-checked against the paper" },
  { key: "voicing", label: "Record the voice", hint: "ElevenLabs, one clip per scene" },
  { key: "rendering", label: "Animate & render", hint: "Remotion → MP4" },
];
const ORDER: ExplainerStatus[] = ["queued", "extracting", "scripting", "voicing", "rendering", "ready"];

const statusMeta: Record<ExplainerStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "faint" },
  extracting: { label: "Reading paper", tone: "sky" },
  scripting: { label: "Writing script", tone: "lavender" },
  voicing: { label: "Recording voice", tone: "sun" },
  rendering: { label: "Rendering", tone: "coral" },
  ready: { label: "Ready", tone: "mint" },
  failed: { label: "Failed", tone: "pink" },
};

const kindTone: Record<ExplainerScene["kind"], Tone> = {
  intro: "sun", problem: "coral", method: "lavender", equation: "sky", result: "mint", conclusion: "sun",
};

const busy = (s: ExplainerStatus) => s !== "ready" && s !== "failed";
const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Paper-to-Video Explainer: pick a paper, generate, follow the pipeline live, watch and check the script. */
export function ExplainerStudio({ workspaceId }: { workspaceId: string }) {
  const ws = useWorkspace(workspaceId);
  const videos = useExplainerVideos(workspaceId);
  const [selected, setSelected] = React.useState<number | null>(null);
  const list = videos.data ?? [];
  const current = selected ?? list[0]?.id ?? null;

  if (ws.isPending || videos.isPending) return <div className="grid gap-6 lg:grid-cols-[380px_1fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>;
  if (ws.error) return <ErrorState error={ws.error} onRetry={() => void ws.refetch()} />;
  if (videos.error) return <ErrorState error={videos.error} title="Couldn't load the explainer videos" onRetry={() => void videos.refetch()} />;
  const readOnly = ws.data?.role === "viewer";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-6">
        {!readOnly && <CreateCard workspaceId={workspaceId} onCreated={setSelected} />}
        <Card className="p-5">
          <SectionTitle title="Your videos" action={<Badge>{list.length}</Badge>} />
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No videos yet. Pick a paper and press Generate.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {list.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => setSelected(v.id)} aria-current={current === v.id ? "true" : undefined}
                    className={cn("flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                      current === v.id ? "border-ink bg-lavender-soft shadow-pop" : "border-line bg-white hover:bg-canvas")}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2 border-ink bg-white"><FilmSlate size={20} weight="duotone" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{v.paper_title || `Video #${v.id}`}</span>
                      <span className="block text-xs text-muted">{formatDateTime(v.created_at)}{v.duration_seconds ? ` · ${fmtDuration(v.duration_seconds)}` : ""}</span>
                    </span>
                    <Badge tone={statusMeta[v.status].tone} solid={v.status === "ready"}>{statusMeta[v.status].label}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="min-w-0">
        {current ? <VideoPanel videoId={current} workspaceId={workspaceId} readOnly={readOnly} onDeleted={() => setSelected(null)} /> : <Intro />}
      </div>
    </div>
  );
}

function Intro() {
  return (
    <Card className="overflow-hidden p-8">
      <div className="flex flex-col items-start gap-4">
        <span className="-rotate-2 rounded-full border-2 border-ink bg-sun px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] shadow-pop">Paper → Video</span>
        <h2 className="text-3xl font-semibold">Turn a research paper into a 3–5 minute explainer</h2>
        <p className="max-w-xl text-ink-soft">Tapu, our mascot, explains the problem, the method and the results in a voiceover while the paper&apos;s own figures and equations appear on screen. Every number and quote is checked against the paper before anything is recorded.</p>
        <ol className="grid w-full gap-3 sm:grid-cols-4">
          {STAGES.map((s, i) => (
            <li key={s.key} className="rounded-2xl border border-line bg-canvas p-3">
              <p className="font-display text-lg font-bold">{i + 1}</p>
              <p className="text-sm font-bold">{s.label}</p>
              <p className="text-xs text-muted">{s.hint}</p>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function CreateCard({ workspaceId, onCreated }: { workspaceId: string; onCreated: (id: number) => void }) {
  const ws = useWorkspace(workspaceId);
  const voices = useExplainerVoices();
  const qc = useQueryClient();
  const papers = (ws.data?.uploads ?? []).filter((u) => u.kind === "paper");
  const [paper, setPaper] = React.useState<string>("");
  const [voice, setVoice] = React.useState<string>("");
  const [fresh, setFresh] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const chosen = paper || papers.at(-1)?.id || "";

  const upload = useMutation({
    mutationFn: (file: File) => workspaceApi.upload(workspaceId, { kind: "paper", file }),
    onSuccess: async (u) => {
      await qc.invalidateQueries({ queryKey: qk.workspace(workspaceId) });
      setPaper(String(u.id));
      toast.success("Paper uploaded", u.filename ?? undefined);
    },
    onError: (e) => toast.error("Upload failed", userMessage(e)),
  });
  const create = useMutation({
    mutationFn: () => explainerApi.create(workspaceId, { upload_id: Number(chosen), voice_id: voice || undefined, fresh_script: fresh }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "explainer"] });
      onCreated(r.id);
      if (!r.queued) toast.info("A video for this paper is already being made", "Showing its progress.");
    },
    onError: (e) => toast.error("Couldn't start the video", userMessage(e)),
  });

  return (
    <Card className="p-5">
      <SectionTitle kicker="Paper → Video" title="Make an explainer" />
      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold">Paper</p>
          {papers.length === 0 && <p className="mb-2 rounded-2xl bg-canvas p-3 text-sm text-muted">No paper in this workspace yet. Upload a PDF to start.</p>}
          <ul className="space-y-2" role="radiogroup" aria-label="Paper">
            {papers.map((u) => (
              <li key={u.id}>
                <button type="button" role="radio" aria-checked={chosen === u.id} onClick={() => setPaper(u.id)}
                  className={cn("flex w-full items-center gap-3 rounded-2xl border p-3 text-left text-sm", chosen === u.id ? "border-ink bg-sun-soft font-bold" : "border-line bg-white")}>
                  <FilePdf size={20} weight="duotone" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{u.filename ?? u.path_or_url}</span>
                  {chosen === u.id && <CheckCircle size={18} weight="fill" className="text-purple" />}
                </button>
              </li>
            ))}
          </ul>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          <Button variant="outline" size="sm" className="mt-2" loading={upload.isPending} onClick={() => fileRef.current?.click()}><UploadSimple size={16} /> Upload a PDF</Button>
        </div>
        <Field label="Voice" htmlFor="ex-voice" hint="ElevenLabs premade voices">
          <Select id="ex-voice" value={voice || voices.data?.default || ""} onChange={(e) => setVoice(e.target.value)}>
            {(voices.data?.voices ?? []).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.description}</option>)}
          </Select>
        </Field>
        <label className="flex items-start gap-3 rounded-2xl bg-canvas p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-purple" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
          <span><b>Write a new script</b><span className="block text-xs text-muted">Off: reuses the saved script and voice clips for this paper, so a re-render costs no voice credits.</span></span>
        </label>
        {voices.data && !voices.data.configured && <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-sm text-danger">ElevenLabs is not configured on the server (ELEVENLABS_API_KEYS).</p>}
        <Button variant="purple" className="w-full" loading={create.isPending} disabled={!chosen || upload.isPending || (voices.data && !voices.data.configured)} onClick={() => create.mutate()}>
          <Sparkle size={18} weight="fill" /> Generate video
        </Button>
      </div>
    </Card>
  );
}

function Stepper({ v }: { v: ExplainerVideo }) {
  const at = ORDER.indexOf(v.status);
  return (
    <div className="space-y-4">
      <ol className="grid gap-3 sm:grid-cols-4">
        {STAGES.map((s) => {
          const i = ORDER.indexOf(s.key);
          const done = at > i;
          const active = at === i;
          return (
            <li key={s.key} className={cn("rounded-2xl border p-3", active ? "border-ink bg-lavender-soft shadow-pop" : done ? "border-line bg-mint-soft" : "border-line bg-white")}>
              <p className="flex items-center gap-2 text-sm font-bold">
                {done ? <CheckCircle size={18} weight="fill" className="text-success" /> : active ? (
                  <motion.span className="inline-block h-3 w-3 rounded-full bg-purple" animate={{ scale: [1, 1.4, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                ) : <span className="inline-block h-3 w-3 rounded-full bg-ink/15" />}
                {s.label}
              </p>
              <p className="mt-1 text-xs text-muted">{s.hint}</p>
            </li>
          );
        })}
      </ol>
      <Progress value={v.progress} label="Video progress" />
      <p role="status" className="text-sm text-ink-soft">{v.message || "Working…"} <span className="tabular text-muted">({Math.round(v.progress * 100)}%)</span></p>
    </div>
  );
}

function VideoPanel({ videoId, workspaceId, readOnly, onDeleted }: { videoId: number; workspaceId: string; readOnly: boolean; onDeleted: () => void }) {
  const q = useExplainerVideo(videoId);
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: (fresh: boolean) => explainerApi.create(workspaceId, { upload_id: q.data!.upload_id!, voice_id: q.data!.voice_id || undefined, fresh_script: fresh }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "explainer"] }),
    onError: (e) => toast.error("Couldn't start again", userMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => explainerApi.remove(videoId),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "explainer"] }); onDeleted(); },
    onError: (e) => toast.error("Couldn't delete", userMessage(e)),
  });
  const prev = React.useRef<ExplainerStatus | null>(null);
  React.useEffect(() => {
    const s = q.data?.status;
    if (s && prev.current && prev.current !== s && (s === "ready" || s === "failed")) {
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "explainer"] });
      if (s === "ready") toast.success("Your explainer video is ready");
    }
    prev.current = s ?? null;
  }, [q.data?.status, qc, workspaceId]);

  if (q.isPending) return <Skeleton className="h-[520px]" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  const script = v.script && "scenes" in v.script ? v.script : null;

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-purple-deep">Explainer video #{v.id}</p>
            <h2 className="mt-1 text-xl font-semibold sm:text-2xl">{script?.title || v.paper_title}</h2>
            {script?.authors && <p className="mt-1 text-sm text-muted">{script.authors}</p>}
          </div>
          <Badge tone={statusMeta[v.status].tone} solid>{statusMeta[v.status].label}</Badge>
        </div>

        <div className="mt-5">
          {busy(v.status) && <Stepper v={v} />}
          {v.status === "failed" && (
            <div role="alert" className="space-y-3 rounded-2xl bg-danger-soft p-4 text-sm">
              <p className="flex items-start gap-2 font-semibold text-danger"><WarningCircle size={18} className="mt-0.5 shrink-0" /> The video could not be made.</p>
              <p className="whitespace-pre-wrap break-words font-mono text-xs text-ink-soft">{v.error || "Unknown error"}</p>
              {!readOnly && v.upload_id && <Button size="sm" variant="outline" loading={retry.isPending} onClick={() => retry.mutate(false)}><ArrowClockwise size={16} /> Try again</Button>}
            </div>
          )}
          {v.status === "ready" && v.has_video && (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-[28px] border-2 border-ink bg-pill shadow-pop-lg">
                <video key={v.id} controls preload="metadata" className="aspect-video w-full bg-pill" src={explainerApi.videoUrl(v.id)} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="purple" size="sm"><a href={explainerApi.videoUrl(v.id, true)}><DownloadSimple size={16} /> Download MP4</a></Button>
                {!readOnly && v.upload_id && <Button size="sm" variant="outline" loading={retry.isPending} onClick={() => retry.mutate(true)}><ArrowClockwise size={16} /> New script</Button>}
                {!readOnly && <Button size="sm" variant="ghost" loading={del.isPending} onClick={() => del.mutate()}><Trash size={16} /> Delete</Button>}
                <span className="ml-auto text-xs text-muted tabular">{fmtDuration(v.duration_seconds)} · {formatDateTime(v.updated_at)}</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      {script && <ScriptView videoId={v.id} scenes={script.scenes} />}
      {!script && !busy(v.status) && v.status !== "failed" && <EmptyState title="No script recorded" />}
    </div>
  );
}

function ScriptView({ videoId, scenes }: { videoId: number; scenes: ExplainerScene[] }) {
  return (
    <Card className="p-5 sm:p-6">
      <SectionTitle kicker={`${scenes.length} scenes`} title="Script" />
      <ol className="mt-4 space-y-3">
        {scenes.map((s, i) => {
          const asset = s.equation_id ? `equations/${s.equation_id}.png` : s.figure_id ? `figures/${s.figure_id}.png` : null;
          return (
            <li key={i} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-bold text-muted">{i + 1}</span>
                <Badge tone={kindTone[s.kind]}>{s.kicker}</Badge>
                <span className="font-bold">{s.heading}</span>
                <span className="ml-auto flex items-center gap-1 text-xs text-muted"><Microphone size={14} /> {s.narration.split(/\s+/).length} words · {s.pose}</span>
              </div>
              <div className={cn("mt-3 grid gap-4", asset && "md:grid-cols-[1fr_220px]")}>
                <div className="space-y-2">
                  <p className="text-sm leading-relaxed text-ink-soft">{s.narration}</p>
                  {s.points.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm">{s.points.map((p, k) => <li key={k}>{p.text}</li>)}</ul>}
                  {s.quotes.map((qt, k) => (
                    <blockquote key={k} className="flex gap-2 rounded-xl border-l-4 border-purple bg-lavender-soft/60 p-2 text-sm italic">
                      <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-purple" />
                      <span>{qt.text} <span className="not-italic text-xs font-semibold text-muted">· page {qt.page}</span></span>
                    </blockquote>
                  ))}
                </div>
                {asset && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={explainerApi.assetUrl(videoId, asset)} alt={s.equation_id ? "Equation from the paper" : "Figure from the paper"} className="w-full rounded-xl border border-line bg-canvas object-contain p-2" loading="lazy" />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
