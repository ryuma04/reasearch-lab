"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, FilePdf, LinkSimple, Database, GithubLogo, X, CloudArrowUp, WarningCircle, Scales } from "@phosphor-icons/react";
import { workspaceApi, runApi } from "@/lib/api/services";
import { isApiError, userMessage } from "@/lib/api/errors";
import type { ComputeBudget } from "@/lib/api/types";
import { qk } from "@/lib/hooks/queries";
import { LIMITS } from "@/lib/config";
import { BUDGETS } from "@/lib/status";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, Chip, Field, Input, SectionTitle, Textarea, Progress, Badge } from "@/components/ui/primitives";
import { toast } from "@/components/ui/overlays";

type PaperInput = { key: string; kind: "file"; file: File } | { key: string; kind: "arxiv"; url: string };
type UploadState = { label: string; status: "pending" | "uploading" | "done" | "error"; progress: number | null; error?: string };

const ARXIV = /^(https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\/[\w.\-/]+(v\d+)?(\.pdf)?|\d{4}\.\d{4,5}(v\d+)?)$/i;
const HTTP_URL = /^https?:\/\/[^\s]+$/i;
const GH_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i;

export default function NewWorkspacePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = React.useState("");
  const [papers, setPapers] = React.useState<PaperInput[]>([]);
  const [arxiv, setArxiv] = React.useState("");
  const [datasetFile, setDatasetFile] = React.useState<File | null>(null);
  const [datasetUrl, setDatasetUrl] = React.useState("");
  const [repoUrl, setRepoUrl] = React.useState("");
  const [note, setNote] = React.useState("");
  const [budget, setBudget] = React.useState<ComputeBudget>("quick");
  const [startNow, setStartNow] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [uploads, setUploads] = React.useState<UploadState[]>([]);
  const [phase, setPhase] = React.useState<"form" | "submitting" | "partial">("form");
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const dropRef = React.useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const next: PaperInput[] = [];
    const errs: string[] = [];
    for (const f of Array.from(files)) {
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) errs.push(`${f.name}: only PDF files are accepted`);
      else if (f.size > LIMITS.paperMaxBytes) errs.push(`${f.name}: larger than ${formatBytes(LIMITS.paperMaxBytes)}`);
      else next.push({ key: `${f.name}-${f.size}-${f.lastModified}`, kind: "file", file: f });
    }
    setPapers((p) => [...p, ...next.filter((n) => !p.some((x) => x.key === n.key))].slice(0, LIMITS.maxPapers));
    setErrors((e) => ({ ...e, papers: errs.join(" · ") }));
  };

  const addArxiv = () => {
    const v = arxiv.trim();
    if (!ARXIV.test(v)) return setErrors((e) => ({ ...e, arxiv: "Enter an arXiv link (arxiv.org/abs/…) or an ID like 1503.02531" }));
    const url = /^\d/.test(v) ? `https://arxiv.org/abs/${v}` : v;
    setPapers((p) => (p.some((x) => x.kind === "arxiv" && x.url === url) ? p : [...p, { key: url, kind: "arxiv" as const, url }]).slice(0, LIMITS.maxPapers));
    setArxiv("");
    setErrors((e) => ({ ...e, arxiv: "" }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Give the workspace a title";
    else if (title.length > LIMITS.titleMax) e.title = `Max ${LIMITS.titleMax} characters`;
    if (!papers.length) e.papers = "At least one research paper (PDF or arXiv link) is required";
    if (datasetFile && datasetFile.size > LIMITS.datasetMaxBytes) e.dataset = `Dataset is larger than ${formatBytes(LIMITS.datasetMaxBytes)}; use a link instead`;
    if (datasetUrl && !HTTP_URL.test(datasetUrl.trim())) e.dataset = "Enter a valid http(s) link";
    if (repoUrl && !GH_REPO.test(repoUrl.trim())) e.repo = "Enter a GitHub repository URL like https://github.com/owner/repo";
    if (note.length > LIMITS.noteMax) e.note = `Max ${LIMITS.noteMax} characters`;
    setErrors(e);
    return Object.values(e).every((v) => !v);
  };

  const runUploads = async (wsId: string, only?: number[]) => {
    const jobs: { label: string; run: (p: (n: number) => void, s: AbortSignal) => Promise<unknown> }[] = [
      ...papers.map((p) => ({
        label: p.kind === "file" ? p.file.name : p.url,
        run: (onP: (n: number) => void, s: AbortSignal) =>
          workspaceApi.upload(wsId, p.kind === "file" ? { kind: "paper", file: p.file } : { kind: "paper", url: p.url }, (pr) => onP(pr.loaded / pr.total), s),
      })),
      ...(datasetFile ? [{ label: datasetFile.name, run: (onP: (n: number) => void, s: AbortSignal) => workspaceApi.upload(wsId, { kind: "dataset", file: datasetFile }, (pr) => onP(pr.loaded / pr.total), s) }] : []),
      ...(datasetUrl.trim() ? [{ label: datasetUrl.trim(), run: (_: (n: number) => void, s: AbortSignal) => workspaceApi.upload(wsId, { kind: "dataset", url: datasetUrl.trim() }, undefined, s) }] : []),
      ...(repoUrl.trim() ? [{ label: repoUrl.trim(), run: (_: (n: number) => void, s: AbortSignal) => workspaceApi.upload(wsId, { kind: "repo_link", url: repoUrl.trim() }, undefined, s) }] : []),
    ];
    setUploads((prev) => jobs.map((j, i) => (only && !only.includes(i) && prev[i] ? prev[i]! : { label: j.label, status: "pending", progress: null })));
    const ac = new AbortController();
    abortRef.current = ac;
    let failed = 0;
    for (let i = 0; i < jobs.length; i++) {
      if (only && !only.includes(i)) continue;
      const set = (s: Partial<UploadState>) => setUploads((u) => u.map((x, k) => (k === i ? { ...x, ...s } : x)));
      set({ status: "uploading", progress: null, error: undefined });
      try {
        await jobs[i]!.run((n) => set({ progress: n }), ac.signal);
        set({ status: "done", progress: 1 });
      } catch (e) {
        failed++;
        set({ status: "error", error: userMessage(e) });
        if (isApiError(e) && e.kind === "aborted") break;
      }
    }
    return failed;
  };

  const finish = async (wsId: string) => {
    await qc.invalidateQueries({ queryKey: qk.workspaces });
    if (startNow) {
      try {
        const run = await runApi.start(wsId, { compute_budget: budget });
        toast.success("Run started", "The agent team is getting to work.");
        router.push(`/workspaces/${wsId}/live?run=${encodeURIComponent(run.id)}`);
        return;
      } catch (e) {
        toast.error("Workspace created, but the run didn't start", userMessage(e));
      }
    }
    router.push(`/workspaces/${wsId}`);
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setPhase("submitting");
    try {
      const ws = workspaceId ? { id: workspaceId } : await workspaceApi.create({ title: title.trim(), compute_budget: budget, note: note.trim() || undefined });
      setWorkspaceId(ws.id);
      const failed = await runUploads(ws.id);
      if (failed) {
        setPhase("partial");
        toast.error("Some uploads failed", "Retry them, or continue without them.");
        return;
      }
      await finish(ws.id);
    } catch (e) {
      setPhase("form");
      if (isApiError(e) && Object.keys(e.fields).length) setErrors(e.fields);
      toast.error("Couldn't create the workspace", userMessage(e));
    }
  };

  const retryFailed = async () => {
    if (!workspaceId) return;
    setPhase("submitting");
    const idx = uploads.map((u, i) => (u.status === "error" ? i : -1)).filter((i) => i >= 0);
    const failed = await runUploads(workspaceId, idx);
    if (failed) setPhase("partial");
    else await finish(workspaceId);
  };

  const busy = phase === "submitting";
  const paperUploadedOk = uploads.slice(0, papers.length).some((u) => u.status === "done");

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-4xl space-y-6">
      <SectionTitle kicker="Step 1 of 2" title="Create a research workspace" />

      <Card className="space-y-5 p-6">
        <Field label="Workspace title" htmlFor="ws-title" required error={errors.title}>
          <Input id="ws-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Distillation — Hinton 2015" maxLength={LIMITS.titleMax + 10} aria-invalid={!!errors.title} disabled={!!workspaceId} />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Research paper(s) <span className="text-coral-deep">*</span> <span className="text-xs font-medium text-muted">PDF or arXiv · up to {LIMITS.maxPapers} (two papers = Paper vs Paper comparison)</span></p>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            className={cn("rounded-[24px] border-2 border-dashed bg-canvas p-6 text-center", errors.papers ? "border-danger/50" : "border-ink/20")}
          >
            <CloudArrowUp size={36} weight="duotone" className="mx-auto text-purple" />
            <p className="mt-2 text-sm font-semibold">Drop a PDF here, or</p>
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => dropRef.current?.click()} disabled={papers.length >= LIMITS.maxPapers || !!workspaceId}>Choose PDF</Button>
            <input ref={dropRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            <p className="mt-2 text-xs text-muted">Max {formatBytes(LIMITS.paperMaxBytes)} per file</p>
          </div>
          <div className="flex gap-2">
            <Input value={arxiv} onChange={(e) => setArxiv(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addArxiv(); } }} placeholder="…or paste an arXiv link / ID (1503.02531)" aria-label="arXiv link" aria-invalid={!!errors.arxiv} disabled={papers.length >= LIMITS.maxPapers || !!workspaceId} />
            <Button type="button" variant="secondary" onClick={addArxiv} disabled={!arxiv.trim() || papers.length >= LIMITS.maxPapers}><LinkSimple size={18} /> Add</Button>
          </div>
          {(errors.arxiv || errors.papers) && <p className="text-xs font-semibold text-danger" role="alert">{errors.arxiv || errors.papers}</p>}
          {papers.length > 0 && (
            <ul className="space-y-2">
              {papers.map((p) => (
                <li key={p.key} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-clay-sm">
                  {p.kind === "file" ? <FilePdf size={22} weight="duotone" className="text-coral-deep" /> : <LinkSimple size={22} className="text-sky-deep" />}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.kind === "file" ? p.file.name : p.url}</span>
                  {p.kind === "file" && <span className="text-xs text-muted">{formatBytes(p.file.size)}</span>}
                  {!workspaceId && <button type="button" onClick={() => setPapers((x) => x.filter((y) => y.key !== p.key))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-ink/5" aria-label="Remove paper"><X size={14} weight="bold" /></button>}
                </li>
              ))}
            </ul>
          )}
          {papers.length === 2 && <Badge tone="lavender"><Scales size={12} /> Paper vs Paper: both will be tested under the same conditions</Badge>}
        </div>
      </Card>

      <Card className="grid gap-5 p-6 md:grid-cols-2">
        <Field label="Dataset" htmlFor="ws-data" error={errors.dataset} hint={`File up to ${formatBytes(LIMITS.datasetMaxBytes)} or a link`}>
          <div className="space-y-2">
            <Input id="ws-data" value={datasetUrl} onChange={(e) => setDatasetUrl(e.target.value)} placeholder="https://… (link)" disabled={!!datasetFile || !!workspaceId} aria-invalid={!!errors.dataset} />
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-purple-deep">
              <Database size={18} /> {datasetFile ? `${datasetFile.name} (${formatBytes(datasetFile.size)})` : "or upload a file"}
              <input type="file" hidden disabled={!!workspaceId} onChange={(e) => setDatasetFile(e.target.files?.[0] ?? null)} />
            </label>
            {datasetFile && !workspaceId && <button type="button" className="text-xs text-muted underline" onClick={() => setDatasetFile(null)}>Remove file</button>}
          </div>
        </Field>
        <Field label="Source code repository" htmlFor="ws-repo" error={errors.repo} hint="Official or reference code on GitHub">
          <div className="relative">
            <GithubLogo size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="ws-repo" className="pl-11" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" disabled={!!workspaceId} aria-invalid={!!errors.repo} />
          </div>
        </Field>
        <div className="md:col-span-2">
          <Field label="Note for the agents" htmlFor="ws-note" error={errors.note} hint={`e.g. “I only have a laptop, keep it under 15 minutes” or “focus on Table 2”. ${note.length}/${LIMITS.noteMax}`}>
            <Textarea id="ws-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={!!workspaceId} aria-invalid={!!errors.note} />
          </Field>
        </div>
      </Card>

      <Card className="p-6">
        <p className="text-sm font-semibold">Compute budget <span className="text-coral-deep">*</span></p>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Compute budget">
          {BUDGETS.map((b) => (
            <Chip key={b.key} role="radio" aria-checked={budget === b.key} selected={budget === b.key} onClick={() => setBudget(b.key)} disabled={!!workspaceId}>
              {budget === b.key && <CheckCircle size={16} weight="fill" />} {b.label} <span className="font-medium opacity-70">· {b.hint}</span>
            </Chip>
          ))}
        </div>
        <label className="mt-5 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} className="h-4 w-4 accent-purple" /> Start the run right away and open the Live Agent Board</label>
      </Card>

      {uploads.length > 0 && (
        <Card variant="bento" className="space-y-3 p-5" aria-live="polite">
          <p className="text-sm font-bold">Uploads</p>
          {uploads.map((u, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                {u.status === "done" ? <CheckCircle size={16} weight="fill" className="text-success" /> : u.status === "error" ? <WarningCircle size={16} weight="fill" className="text-danger" /> : <span className="h-4 w-4 animate-spin rounded-full border-2 border-purple border-r-transparent" />}
                <span className="min-w-0 flex-1 truncate">{u.label}</span>
                <span className="text-xs text-muted">{u.status === "uploading" ? (u.progress != null ? `${Math.round(u.progress * 100)}%` : "Sending…") : u.status === "done" ? "Confirmed by backend" : u.status === "error" ? "Failed" : "Waiting"}</span>
              </div>
              {u.status === "uploading" && u.progress != null && <Progress value={u.progress} label={`Upload ${u.label}`} />}
              {u.error && <p className="text-xs text-danger">{u.error}</p>}
            </div>
          ))}
        </Card>
      )}

      <div className="sticky bottom-24 z-10 flex flex-wrap justify-end gap-2 rounded-[24px] bg-canvas-cool/90 p-2 backdrop-blur md:bottom-4">
        {busy && <Button type="button" variant="ghost" onClick={() => abortRef.current?.abort()}>Cancel uploads</Button>}
        {phase === "partial" && (
          <>
            <Button type="button" variant="secondary" onClick={() => void retryFailed()}>Retry failed uploads</Button>
            {paperUploadedOk && workspaceId && <Button type="button" variant="outline" onClick={() => void finish(workspaceId)}>Continue without them</Button>}
          </>
        )}
        {phase !== "partial" && (
          <Button type="submit" size="lg" variant="purple" loading={busy}>{busy ? "Creating…" : startNow ? "Create & start run" : "Create workspace"}</Button>
        )}
      </div>
    </form>
  );
}
