"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, GithubLogo, LinkBreak, Plus, Star, ArrowSquareOut, LockSimple, Globe, Warning } from "@phosphor-icons/react";
import { githubApi, githubLoginUrl } from "@/lib/api/services";
import { isApiError, userMessage } from "@/lib/api/errors";
import { qk, useMe, useMyPushes, useRepos } from "@/lib/hooks/queries";
import { USE_MOCKS } from "@/lib/config";
import { pushStatusMeta } from "@/lib/status";
import { formatDateTime } from "@/lib/utils";
import { Avatar } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Input, SectionTitle } from "@/components/ui/primitives";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/states";
import { Sheet, toast } from "@/components/ui/overlays";

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export default function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const connected = me.data?.github.status === "connected";
  const repos = useRepos(connected);
  const pushes = useMyPushes();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [filter, setFilter] = React.useState("");

  const setDefault = useMutation({
    mutationFn: (full_name: string) => githubApi.setDefaultRepo({ full_name }),
    onSuccess: async (_d, name) => {
      await qc.invalidateQueries({ queryKey: qk.me });
      toast.success("Push repository updated", name);
    },
    onError: (e) => toast.error("Couldn't change repository", userMessage(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => githubApi.disconnect(),
    onSuccess: async () => {
      setConfirmDisconnect(false);
      await qc.invalidateQueries({ queryKey: qk.me });
      qc.removeQueries({ queryKey: qk.repos });
      toast.success("GitHub disconnected", "Your token was removed and access revoked.");
    },
    onError: (e) => toast.error("Couldn't disconnect", userMessage(e)),
  });

  if (!me.data) return null;
  const { user, github } = me.data;
  const reconnect = () => {
    if (USE_MOCKS) return toast.info("Demo mode", "Reconnecting is simulated by signing in again.");
    window.location.assign(githubLoginUrl("/profile"));
  };
  const shown = (repos.data ?? []).filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-8">
      <SectionTitle kicker="Account" title="Profile & GitHub" />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <Avatar src={user.avatar_url} name={user.name ?? user.github_username} size={64} />
            <div className="min-w-0">
              <p className="truncate font-display text-xl font-bold">{user.name ?? user.github_username}</p>
              <p className="truncate text-sm text-muted">@{user.github_username}</p>
              <p className="truncate text-sm text-muted">{user.email ?? "No public email"}</p>
            </div>
          </div>
          <dl className="mt-6 grid gap-3 text-sm">
            <div className="rounded-2xl bg-canvas p-3"><dt className="text-xs text-muted">GitHub connection</dt>
              <dd className="mt-1 flex items-center gap-2 font-semibold">{connected ? <><CheckCircle size={16} weight="fill" className="text-success" /> Connected</> : <><Warning size={16} weight="fill" className="text-warning" /> Not connected</>}</dd></div>
            <div className="rounded-2xl bg-canvas p-3"><dt className="text-xs text-muted">Push repository</dt><dd className="mt-1 break-all font-semibold">{github.default_repo ?? "Not chosen"}</dd></div>
            <div className="rounded-2xl bg-canvas p-3"><dt className="text-xs text-muted">Granted scopes</dt><dd className="mt-1 flex flex-wrap gap-1">{github.scopes.length ? github.scopes.map((s) => <Badge key={s}>{s}</Badge>) : "—"}</dd></div>
            <div className="rounded-2xl bg-canvas p-3"><dt className="text-xs text-muted">Connected since</dt><dd className="mt-1 font-semibold">{formatDateTime(github.connected_at)}</dd></div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-2">
            {connected ? (
              <Button variant="danger" size="sm" onClick={() => setConfirmDisconnect(true)}><LinkBreak size={16} weight="bold" /> Disconnect</Button>
            ) : (
              <Button size="sm" onClick={reconnect}><GithubLogo size={16} weight="bold" /> Connect GitHub</Button>
            )}
          </div>
          {!connected && <p className="mt-3 text-xs text-muted">GitHub must be connected before results can be pushed (Checkpoint 2).</p>}
        </Card>

        <Card className="p-6">
          <SectionTitle title="Choose a repository" action={connected ? <Button size="sm" variant="soft" onClick={() => setCreateOpen(true)}><Plus size={16} weight="bold" /> Create new</Button> : undefined} />
          {!connected ? (
            <EmptyState title="Connect GitHub first" body="We list your repositories once GitHub is connected." icon={<GithubLogo size={34} weight="duotone" className="text-purple-deep" />} />
          ) : repos.isPending ? (
            <div className="mt-4"><SkeletonList rows={4} /></div>
          ) : repos.error ? (
            <div className="mt-4"><ErrorState error={repos.error} title={isApiError(repos.error) && repos.error.kind === "forbidden" ? "GitHub permission denied" : "Couldn't load repositories"} onRetry={() => void repos.refetch()} /></div>
          ) : (
            <>
              <Input className="mt-4" placeholder="Filter repositories…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter repositories" />
              <ul className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto pr-1">
                {shown.length === 0 && <li className="p-4 text-center text-sm text-muted">No repositories match.</li>}
                {shown.map((r) => {
                  const isDefault = github.default_repo === r.full_name;
                  return (
                    <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3">
                      {r.private ? <LockSimple size={18} className="shrink-0 text-muted" /> : <Globe size={18} className="shrink-0 text-muted" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.full_name}</p>
                        {r.description && <p className="truncate text-xs text-muted">{r.description}</p>}
                      </div>
                      <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="grid h-8 w-8 place-items-center rounded-full hover:bg-ink/5" aria-label={`Open ${r.full_name} on GitHub`}><ArrowSquareOut size={16} /></a>
                      {isDefault ? (
                        <Badge tone="mint" solid><Star size={12} weight="fill" /> Selected</Badge>
                      ) : (
                        <Button size="sm" variant="secondary" disabled={r.can_push === false} loading={setDefault.isPending && setDefault.variables === r.full_name} onClick={() => setDefault.mutate(r.full_name)}>
                          Use
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>

      <section>
        <SectionTitle title="Published research" kicker="GitHub pushes" />
        <div className="mt-4">
          {pushes.isPending ? <SkeletonList rows={2} /> : pushes.error ? <ErrorState error={pushes.error} title="Published research" onRetry={() => void pushes.refetch()} /> : !pushes.data?.length ? (
            <EmptyState title="Nothing published yet" body="After you approve a push, the repository link appears here." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pushes.data.map((p) => (
                <Card key={p.id} variant="bento" className="flex items-center gap-3 p-4">
                  <GithubLogo size={22} weight="duotone" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{p.workspace_title ?? `Run ${p.run_id}`}</p>
                    <p className="truncate text-xs text-muted">{p.repo_url ?? "—"} · {formatDateTime(p.created_at)}</p>
                  </div>
                  <Badge tone={pushStatusMeta[p.status].tone} solid>{pushStatusMeta[p.status].label}</Badge>
                  {p.repo_url && p.status === "succeeded" && <a className="text-sm font-semibold text-purple-deep underline" href={p.repo_url} target="_blank" rel="noopener noreferrer">Open</a>}
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      <CreateRepoSheet open={createOpen} onOpenChange={setCreateOpen} />

      <Sheet open={confirmDisconnect} onOpenChange={setConfirmDisconnect} title="Disconnect GitHub?" mode="center" description="We will delete your stored token and revoke our access on GitHub.">
        <p className="text-sm text-ink-soft">You won&apos;t be able to push results until you connect again. Existing repositories are not touched.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
          <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button>
        </div>
      </Sheet>
    </div>
  );
}

function CreateRepoSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [desc, setDesc] = React.useState("");
  const [priv, setPriv] = React.useState(true);
  const [makeDefault, setMakeDefault] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const repo = await githubApi.createRepo({ name: name.trim(), private: priv, description: desc.trim() || undefined });
      if (makeDefault) await githubApi.setDefaultRepo({ full_name: repo.full_name });
      return repo;
    },
    onSuccess: async (repo) => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.repos }), qc.invalidateQueries({ queryKey: qk.me })]);
      toast.success("Repository created", repo.full_name);
      setName("");
      setDesc("");
      onOpenChange(false);
    },
    onError: (e) => setError(isApiError(e) ? e.fields.name ?? userMessage(e) : userMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!REPO_NAME.test(name.trim())) return setError("Use letters, numbers, '.', '-' or '_' (max 100).");
    setError(null);
    create.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Create a repository" description="Created on GitHub through the backend with your connected account.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Repository name" htmlFor="repo-name" required error={error}>
          <Input id="repo-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "repo-name-error" : undefined} placeholder="distillation-repro" autoFocus />
        </Field>
        <Field label="Description" htmlFor="repo-desc">
          <Input id="repo-desc" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} />
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="h-4 w-4 accent-purple" /> Private repository</label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4 accent-purple" /> Use it for pushes</label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={create.isPending}>Create repository</Button>
        </div>
      </form>
    </Sheet>
  );
}
