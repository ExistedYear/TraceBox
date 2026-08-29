"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, ExternalLink, Github, Link2, RefreshCw, Settings2, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Installation = {
  id: string;
  github_installation_id: number;
  github_account_login: string;
  github_account_type: string;
  repository_selection: string;
  status: string;
  permissions: Record<string, string>;
  last_verified_at: string | null;
  created_at: string;
  suspended_at: string | null;
};

type Repository = {
  id: string;
  installation_id: string;
  github_repository_id: number;
  owner_login: string;
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string | null;
  html_url: string;
  is_accessible: boolean;
  last_synced_at: string | null;
};

type Binding = {
  github_repository_id: string;
  is_primary: boolean;
  auto_resolve_enabled: boolean;
  target_branches: string[];
  created_at: string;
  updated_at: string;
};

type WebhookDelivery = {
  delivery_id: string;
  event_name: string;
  action: string | null;
  status: string;
  attempt_count: number;
  github_installation_id: number | null;
  github_repository_id: number | null;
  received_at: string;
  processed_at: string | null;
};

type BindingDraft = { autoResolveEnabled: boolean; targetBranches: string };
type Tab = "active" | "attention" | "history";

type Props = {
  projectId: string;
  canManage: boolean;
  initialLegacyRepo: string | null;
  initialInstallations: Installation[];
  initialRepositories: Repository[];
  initialBindings: Binding[];
  initialWebhookDeliveries: WebhookDelivery[];
};

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (character) => character.toUpperCase());
}

function eventLabel(event: string, action: string | null) {
  const name = event.replaceAll("_", " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${action ? ` · ${action.replaceAll("_", " ")}` : ""}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function installationUrl(installation: Installation) {
  if (installation.github_account_type === "Organization") {
    return `https://github.com/organizations/${encodeURIComponent(installation.github_account_login)}/settings/installations/${installation.github_installation_id}`;
  }
  return `https://github.com/settings/installations/${installation.github_installation_id}`;
}

function makeBindingDrafts(bindings: Binding[]) {
  return Object.fromEntries(bindings.map((binding) => [binding.github_repository_id, {
    autoResolveEnabled: binding.auto_resolve_enabled,
    targetBranches: (binding.target_branches ?? ["main"]).join(", "),
  }])) as Record<string, BindingDraft>;
}

function statusClasses(status: string) {
  if (status === "ACTIVE" || status === "PROCESSED") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "FAILED" || status === "REVOKED") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (status === "SUSPENDED" || status === "PENDING" || status === "NEEDS_PERMISSION_UPDATE" || status === "PROCESSING") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-border bg-muted text-muted-foreground";
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide", statusClasses(status))}><span className="h-1.5 w-1.5 rounded-full bg-current" />{label ?? statusLabel(status)}</span>;
}

function MetricCard({ label, value, detail, status, icon: Icon }: { label: string; value: string; detail: string; status?: string; icon: typeof Github }) {
  return <div className="rounded-[10px] border border-border/80 bg-card p-4"><div className="flex items-center justify-between gap-3"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{label}</p><Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></div><div className="mt-3 flex items-center gap-2"><p className="text-xl font-semibold tracking-tight">{value}</p>{status && <StatusPill status={status} label={statusLabel(status)} />}</div><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>;
}

export function GithubIntegrationManager({ projectId, canManage, initialLegacyRepo, initialInstallations, initialRepositories, initialBindings, initialWebhookDeliveries }: Props) {
  const [installations, setInstallations] = useState(initialInstallations);
  const [repositories, setRepositories] = useState(initialRepositories);
  const [bindings, setBindings] = useState(initialBindings);
  const [deliveries, setDeliveries] = useState(initialWebhookDeliveries);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(initialBindings.find((binding) => binding.is_primary)?.github_repository_id ?? initialBindings[0]?.github_repository_id ?? "");
  const [autoResolve, setAutoResolve] = useState(initialBindings.find((binding) => binding.is_primary)?.auto_resolve_enabled ?? true);
  const [targetBranches, setTargetBranches] = useState((initialBindings.find((binding) => binding.is_primary)?.target_branches ?? ["main"]).join(", "));
  const [bindingDrafts, setBindingDrafts] = useState<Record<string, BindingDraft>>(() => makeBindingDrafts(initialBindings));
  const [tab, setTab] = useState<Tab>("active");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("github");
    if (result === "connected") toast.success("GitHub App connected. Choose a repository below.");
    if (result === "pending") toast.info("GitHub installation is waiting for organization approval.");
    if (result === "error") toast.error("GitHub could not be connected. Check the App configuration and try again.");
    if (result) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const activeInstallationIds = useMemo(() => new Set(installations.filter((installation) => installation.status === "ACTIVE").map((installation) => installation.id)), [installations]);
  const activeInstallations = useMemo(() => installations.filter((installation) => installation.status === "ACTIVE"), [installations]);
  const availableRepositories = useMemo(() => repositories.filter((repository) => activeInstallationIds.has(repository.installation_id) && repository.is_accessible && !repository.archived), [activeInstallationIds, repositories]);
  const repositoryById = useMemo(() => new Map(repositories.map((repository) => [repository.id, repository])), [repositories]);
  const repositoryByGithubId = useMemo(() => new Map(repositories.map((repository) => [repository.github_repository_id, repository])), [repositories]);
  const installationByGithubId = useMemo(() => new Map(installations.map((installation) => [installation.github_installation_id, installation])), [installations]);
  const latestDelivery = deliveries[0];
  const webhookStatus = latestDelivery?.status === "FAILED" ? "FAILED" : latestDelivery?.status === "PROCESSING" ? "PROCESSING" : latestDelivery ? "PROCESSED" : "UNKNOWN";

  const attentionInstallations = installations.filter((installation) => installation.status !== "ACTIVE");
  const attentionRepositories = repositories.filter((repository) => !repository.is_accessible || repository.archived || !activeInstallationIds.has(repository.installation_id));
  const attentionDeliveries = deliveries.filter((delivery) => delivery.status === "FAILED").slice(0, 5);

  const historyEntries = useMemo(() => {
    const entries = [
      ...deliveries.map((delivery) => ({
        id: `delivery-${delivery.delivery_id}`,
        label: eventLabel(delivery.event_name, delivery.action),
        detail: (delivery.github_repository_id ? repositoryByGithubId.get(delivery.github_repository_id)?.full_name : undefined) ?? (delivery.github_installation_id ? installationByGithubId.get(delivery.github_installation_id)?.github_account_login : undefined) ?? "GitHub App",
        date: delivery.received_at,
        status: delivery.status,
      })),
      ...bindings.map((binding) => ({
        id: `binding-${binding.github_repository_id}`,
        label: "Repository bound to project",
        detail: repositoryById.get(binding.github_repository_id)?.full_name ?? "Unavailable repository",
        date: binding.created_at,
        status: "ACTIVE",
      })),
      ...installations.filter((installation) => installation.status !== "ACTIVE").map((installation) => ({
        id: `installation-${installation.id}`,
        label: `Installation ${statusLabel(installation.status)}`,
        detail: installation.github_account_login,
        date: installation.suspended_at ?? installation.created_at,
        status: installation.status,
      })),
    ];
    return entries.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
  }, [bindings, deliveries, installationByGithubId, installations, repositoryByGithubId, repositoryById]);

  async function reload() {
    const response = await fetch(`/api/github/repositories?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not reload GitHub repositories.");
    const data = await response.json() as { installations: Installation[]; repositories: Repository[]; bindings: Binding[]; webhookDeliveries?: WebhookDelivery[] };
    const nextSelected = data.repositories.some((repository) => repository.id === selectedRepositoryId) ? selectedRepositoryId : data.bindings.find((binding) => binding.is_primary)?.github_repository_id ?? data.bindings[0]?.github_repository_id ?? data.repositories[0]?.id ?? "";
    const nextBinding = data.bindings.find((binding) => binding.github_repository_id === nextSelected) ?? data.bindings.find((binding) => binding.is_primary);
    setInstallations(data.installations);
    setRepositories(data.repositories);
    setBindings(data.bindings);
    setDeliveries(data.webhookDeliveries ?? []);
    setBindingDrafts(makeBindingDrafts(data.bindings));
    setSelectedRepositoryId(nextSelected);
    setAutoResolve(nextBinding?.auto_resolve_enabled ?? true);
    setTargetBranches((nextBinding?.target_branches ?? ["main"]).join(", "));
  }

  async function refreshStatus() {
    if (busy) return;
    setBusy("refresh");
    try { await reload(); toast.success("GitHub connection status refreshed."); } catch { toast.error("Could not refresh GitHub connection status."); } finally { setBusy(null); }
  }

  async function refreshRepositories() {
    if (busy || !canManage) return;
    setBusy("sync");
    try {
      const response = await fetch("/api/github/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId }) });
      if (!response.ok) throw new Error("Could not refresh GitHub repositories.");
      await reload();
      toast.success("GitHub repositories synced.");
    } catch { toast.error("Could not sync GitHub repositories."); } finally { setBusy(null); }
  }

  function selectRepository(repositoryId: string) {
    setSelectedRepositoryId(repositoryId);
    const binding = bindings.find((item) => item.github_repository_id === repositoryId);
    setAutoResolve(binding?.auto_resolve_enabled ?? true);
    setTargetBranches((binding?.target_branches ?? ["main"]).join(", "));
  }

  function getBranches(value: string) {
    return value.split(",").map((branch) => branch.trim()).filter(Boolean);
  }

  async function bindRepository() {
    if (busy || !canManage || !selectedRepositoryId) return;
    const branches = getBranches(targetBranches);
    if (!branches.length) { toast.error("Add at least one target branch."); return; }
    if (branches.length > 20 || branches.some((branch) => branch.length > 120)) { toast.error("Use up to 20 target branches, each 120 characters or fewer."); return; }
    setBusy("bind");
    try {
      const response = await fetch("/api/github/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: selectedRepositoryId, is_primary: false, auto_resolve_enabled: autoResolve, target_branches: branches }) });
      if (!response.ok) throw new Error("Could not connect repository.");
      await reload();
      toast.success("GitHub repository connected.");
    } catch { toast.error("Could not connect GitHub repository."); } finally { setBusy(null); }
  }

  async function updateBinding(binding: Binding) {
    if (busy || !canManage) return;
    const draft = bindingDrafts[binding.github_repository_id];
    const branches = getBranches(draft?.targetBranches ?? "main");
    if (!branches.length) { toast.error("Add at least one target branch."); return; }
    if (branches.length > 20 || branches.some((branch) => branch.length > 120)) { toast.error("Use up to 20 target branches, each 120 characters or fewer."); return; }
    setBusy(`update-${binding.github_repository_id}`);
    try {
      const response = await fetch("/api/github/bind", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: binding.github_repository_id, auto_resolve_enabled: draft?.autoResolveEnabled ?? binding.auto_resolve_enabled, target_branches: branches }) });
      if (!response.ok) throw new Error("Could not update repository settings.");
      await reload();
      toast.success("Repository automation settings saved.");
    } catch { toast.error("Could not save repository automation settings."); } finally { setBusy(null); }
  }

  async function setPrimaryRepository(repositoryId: string) {
    if (busy || !canManage) return;
    setBusy("primary");
    try {
      const response = await fetch("/api/github/primary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: repositoryId }) });
      if (!response.ok) throw new Error("Could not set the primary repository.");
      await reload();
      toast.success("Primary repository updated.");
    } catch { toast.error("Could not set the primary repository."); } finally { setBusy(null); }
  }

  async function unbindRepository(repositoryId: string) {
    if (busy || !canManage || !window.confirm("Disconnect this GitHub repository from the project? Historical links will remain.")) return;
    setBusy(`unbind-${repositoryId}`);
    try {
      const response = await fetch("/api/github/bind", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: repositoryId }) });
      if (!response.ok) throw new Error("Could not disconnect repository.");
      await reload();
      toast.success("GitHub repository disconnected.");
    } catch { toast.error("Could not disconnect GitHub repository."); } finally { setBusy(null); }
  }

  function updateDraft(repositoryId: string, update: Partial<BindingDraft>) {
    setBindingDrafts((current) => ({ ...current, [repositoryId]: { ...current[repositoryId], ...update } }));
  }

  return <section className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-card"><Github className="h-4 w-4" /></span><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Developer integrations</p><h2 className="mt-1 text-xl font-semibold tracking-tight">GitHub</h2><p className="mt-1 max-w-xl text-sm text-muted-foreground">Connect verified repositories to link pull requests, read checks, and automate issue resolution safely.</p></div></div>
      <div className="flex flex-wrap gap-2">{canManage && <Button asChild size="sm" className="h-8 gap-1.5 text-xs"><a href={`/api/github/connect?project_id=${encodeURIComponent(projectId)}`}><Github className="h-3.5 w-3.5" /> Connect GitHub</a></Button>}<Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void refreshStatus()} disabled={Boolean(busy)}><RefreshCw className={cn("h-3.5 w-3.5", busy === "refresh" && "animate-spin")} /> Refresh status</Button>{canManage && <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void refreshRepositories()} disabled={Boolean(busy) || !installations.length}><RefreshCw className={cn("h-3.5 w-3.5", busy === "sync" && "animate-spin")} /> Sync repositories</Button>}</div>
    </div>

    <div className="grid gap-3 md:grid-cols-3"><MetricCard label="Active connection" value={activeInstallations.length ? `${activeInstallations.length} ${activeInstallations.length === 1 ? "account" : "accounts"}` : "Not connected"} detail={activeInstallations[0] ? `@${activeInstallations[0].github_account_login}` : "Maintainers can connect the GitHub App."} status={activeInstallations.length ? "ACTIVE" : "UNKNOWN"} icon={ShieldCheck} /><MetricCard label="Bound repositories" value={String(bindings.length)} detail={bindings.length ? `${bindings.filter((binding) => binding.is_primary).length} primary repository` : "No repository is linked to this project."} icon={Link2} /><MetricCard label="Webhook health" value={webhookStatus === "PROCESSED" ? "Healthy" : webhookStatus === "UNKNOWN" ? "Not verified" : statusLabel(webhookStatus)} detail={latestDelivery ? `Last event ${formatDate(latestDelivery.received_at)} UTC` : "No webhook deliveries recorded yet."} status={webhookStatus} icon={RefreshCw} /></div>

    <div className="flex flex-wrap items-center gap-1 border-b border-border/70"><button type="button" className={cn("border-b-2 px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]", tab === "active" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => setTab("active")}>Active <span className="ml-1 text-muted-foreground">{activeInstallations.length + bindings.length}</span></button><button type="button" className={cn("border-b-2 px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]", tab === "attention" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => setTab("attention")}>Needs attention <span className="ml-1 text-muted-foreground">{attentionInstallations.length + attentionRepositories.length + attentionDeliveries.length}</span></button><button type="button" className={cn("border-b-2 px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]", tab === "history" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => setTab("history")}>History <span className="ml-1 text-muted-foreground">{historyEntries.length}</span></button></div>

    {tab === "active" && <div className="space-y-5">
      <Surface><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-4"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">App installations</p><h3 className="mt-1 text-sm font-semibold">Verified GitHub access</h3><p className="mt-1 text-xs text-muted-foreground">TraceBox uses a separately authorized GitHub App installation. GitHub login remains identity-only.</p></div><StatusPill status={activeInstallations.length ? "ACTIVE" : "UNKNOWN"} label={activeInstallations.length ? "Connected" : "Not connected"} /></div>{activeInstallations.length === 0 ? <EmptyState icon={Github} title="No active GitHub connection" description="Connect the GitHub App to choose repositories from your account or organization." action={canManage ? <Button asChild size="sm" className="h-8 text-xs"><a href={`/api/github/connect?project_id=${encodeURIComponent(projectId)}`}>Connect GitHub</a></Button> : undefined} /> : <div className="divide-y divide-border/60">{activeInstallations.map((installation) => <div key={installation.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-background"><Github className="h-4 w-4" /></span><div><p className="text-sm font-semibold">{installation.github_account_login}</p><p className="text-xs text-muted-foreground">{installation.github_account_type} account · {installation.repository_selection === "all" ? "All repositories" : "Selected repositories"}</p></div></div><div className="flex items-center gap-2">{canManage && <Button asChild type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]"><a href={installationUrl(installation)} target="_blank" rel="noreferrer"><Settings2 className="h-3 w-3" /> Manage installation</a></Button>}<StatusPill status="ACTIVE" label="Connected" /></div></div><div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]"><div><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">Permissions</p><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(installation.permissions ?? {}).map(([permission, level]) => <span key={permission} className="rounded border border-border/70 bg-background px-2 py-1 text-[10px] text-muted-foreground"><span className="text-foreground">{permission.replaceAll("_", " ")}</span> · {level}</span>)}</div></div><div className="text-left sm:text-right"><p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">Last verified</p><p className="mt-2 text-xs text-foreground">{formatDate(installation.last_verified_at)} UTC</p></div></div></div>)}</div>}</Surface>

      <Surface><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-4"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Project bindings</p><h3 className="mt-1 text-sm font-semibold">Bound repositories</h3><p className="mt-1 text-xs text-muted-foreground">Repositories are scoped to this project. Automatic resolution only runs on the target branches configured below.</p></div>{canManage ? <span className="rounded border border-primary/25 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-primary">Maintainer controls</span> : <span className="rounded border border-border/70 bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Developer view</span>}</div>
        {canManage && <div className="grid gap-2 border-b border-border/70 p-4 md:grid-cols-[1fr_auto]"><label className="sr-only" htmlFor="github-repository-picker">GitHub repository</label><select id="github-repository-picker" className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs" value={selectedRepositoryId} onChange={(event) => selectRepository(event.target.value)} disabled={!activeInstallations.length}><option value="">Choose an accessible repository</option>{availableRepositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.full_name}{repository.private ? " · private" : ""}</option>)}</select><Button type="button" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => void bindRepository()} disabled={Boolean(busy) || !selectedRepositoryId}><Link2 className="h-3.5 w-3.5" /> Bind repository</Button></div>}
        {bindings.length === 0 ? <EmptyState icon={Link2} title="No repositories bound" description={activeInstallations.length ? "Choose an accessible repository above to connect it to this project." : "Connect the GitHub App before selecting a project repository."} /> : <div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid grid-cols-[1.6fr_0.8fr_1.1fr_1.1fr_auto] gap-4 border-b border-border/60 px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60"><span>Repository</span><span>Access</span><span>Automation</span><span>Target branches</span><span className="sr-only">Actions</span></div>{bindings.map((binding) => { const repository = repositoryById.get(binding.github_repository_id); const draft = bindingDrafts[binding.github_repository_id] ?? { autoResolveEnabled: binding.auto_resolve_enabled, targetBranches: binding.target_branches.join(", ") }; return <div key={binding.github_repository_id} className="grid grid-cols-[1.6fr_0.8fr_1.1fr_1.1fr_auto] items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-xs font-semibold">{repository?.full_name ?? "Unavailable repository"}</p>{binding.is_primary && <span className="shrink-0 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">Primary</span>}</div><p className="mt-1 truncate text-[10px] text-muted-foreground">Default branch: {repository?.default_branch ?? "unknown"}</p></div><div className="text-[10px] text-muted-foreground">{repository ? repository.private ? "Private" : "Public" : "Unavailable"}<p className="mt-1">Synced {formatDate(repository?.last_synced_at)}</p></div><label className="flex items-center gap-2 text-[10px] text-muted-foreground"><input type="checkbox" checked={draft.autoResolveEnabled} disabled={!canManage || Boolean(busy)} onChange={(event) => updateDraft(binding.github_repository_id, { autoResolveEnabled: event.target.checked })} /><span>Auto-resolve</span></label><label className="space-y-1 text-[10px] text-muted-foreground"><span className="sr-only">Target branches for {repository?.full_name ?? "repository"}</span><input className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground" value={draft.targetBranches} disabled={!canManage || Boolean(busy)} onChange={(event) => updateDraft(binding.github_repository_id, { targetBranches: event.target.value })} aria-label={`Target branches for ${repository?.full_name ?? "repository"}`} /><span className="block text-[9px]">Comma-separated, e.g. main, release/*</span></label><div className="flex items-center justify-end gap-1">{canManage && <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={() => void updateBinding(binding)} disabled={Boolean(busy)}>{busy === `update-${binding.github_repository_id}` ? "Saving…" : "Save"}</Button>}{!binding.is_primary && canManage && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-muted-foreground" onClick={() => void setPrimaryRepository(binding.github_repository_id)} disabled={Boolean(busy)}>Set primary</Button>}{repository?.html_url && <a href={repository.html_url} target="_blank" rel="noreferrer" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${repository.full_name}`}><ExternalLink className="h-3.5 w-3.5" /></a>}{canManage && <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => void unbindRepository(binding.github_repository_id)} disabled={Boolean(busy)} aria-label={`Disconnect ${repository?.full_name ?? "repository"}`}><Trash2 className="h-3.5 w-3.5" /></Button>}</div></div>; })}</div></div>}
      </Surface>

      <div className="rounded-[10px] border border-primary/20 bg-primary/5 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-xs font-semibold">Access and automation are separate</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">TraceBox reads repository metadata, pull requests, commits, and checks through the GitHub App. It does not request write access or your GitHub password. Login with GitHub is still an identity flow, while this installation controls repository access.</p></div></div></div>
    </div>}

    {tab === "attention" && <div className="space-y-5"><Surface><div className="border-b border-border/70 p-4"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Action queue</p><h3 className="mt-1 text-sm font-semibold">Needs attention</h3><p className="mt-1 text-xs text-muted-foreground">Connection states and delivery failures that may prevent repository sync or automation.</p></div>{attentionInstallations.length === 0 && attentionRepositories.length === 0 && attentionDeliveries.length === 0 && !initialLegacyRepo ? <EmptyState icon={Check} title="Everything looks healthy" description="There are no known installation, repository, or webhook issues." /> : <div className="divide-y divide-border/60">{initialLegacyRepo && <div className="flex items-start gap-3 p-4"><CircleAlert className="mt-0.5 h-4 w-4 text-amber-300" /><div><p className="text-xs font-semibold">Legacy repository mapping needs verification</p><p className="mt-1 text-[11px] text-muted-foreground"><code className="font-mono text-foreground">{initialLegacyRepo}</code> is from the older integration path. Reconnect and bind the repository through the GitHub App to verify access.</p></div></div>}{attentionInstallations.map((installation) => <div key={installation.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-4 w-4 text-amber-300" /><div><p className="text-xs font-semibold">{installation.github_account_login} · {statusLabel(installation.status)}</p><p className="mt-1 text-[11px] text-muted-foreground">{installation.status === "PENDING" ? "Organization approval is still required." : installation.status === "NEEDS_PERMISSION_UPDATE" ? "The GitHub App needs permission approval before it can issue usable tokens." : "Reconnect or review the installation in GitHub."}</p></div></div>{canManage && <Button asChild type="button" variant="outline" size="sm" className="h-7 text-[11px]"><a href={installation.status === "PENDING" ? `/api/github/connect?project_id=${encodeURIComponent(projectId)}` : installationUrl(installation)} target={installation.status === "PENDING" ? undefined : "_blank"} rel={installation.status === "PENDING" ? undefined : "noreferrer"}>{installation.status === "PENDING" ? "Reconnect" : "Review installation"}</a></Button>}</div>)}{attentionRepositories.map((repository) => <div key={repository.id} className="flex items-start gap-3 p-4"><CircleAlert className="mt-0.5 h-4 w-4 text-amber-300" /><div><p className="text-xs font-semibold">{repository.full_name} · {repository.archived ? "Archived" : repository.is_accessible ? "Installation inactive" : "Access removed"}</p><p className="mt-1 text-[11px] text-muted-foreground">This repository cannot currently be used for new links or automation. Historical issue links are retained.</p></div></div>)}{attentionDeliveries.map((delivery) => <div key={delivery.delivery_id} className="flex items-start gap-3 p-4"><CircleAlert className="mt-0.5 h-4 w-4 text-red-300" /><div><p className="text-xs font-semibold">Webhook processing failed</p><p className="mt-1 text-[11px] text-muted-foreground">{eventLabel(delivery.event_name, delivery.action)} · received {formatDate(delivery.received_at)} · retry attempt {delivery.attempt_count}.</p></div></div>)}</div>}</Surface></div>}

    {tab === "history" && <Surface><div className="border-b border-border/70 p-4"><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Audit trail</p><h3 className="mt-1 text-sm font-semibold">GitHub connection history</h3><p className="mt-1 text-xs text-muted-foreground">Installation, repository binding, and webhook events for this workspace’s GitHub connections.</p></div>{historyEntries.length === 0 ? <EmptyState icon={Unplug} title="No GitHub history yet" description="Connection and repository events will appear here after the GitHub App is used." /> : <div className="divide-y divide-border/60">{historyEntries.slice(0, 40).map((entry) => <div key={entry.id} className="flex items-center gap-3 p-4"><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border", entry.status === "FAILED" || entry.status === "REVOKED" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-border/70 bg-background text-muted-foreground")}><span className="h-1.5 w-1.5 rounded-full bg-current" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{entry.label}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{entry.detail}</p></div><div className="flex shrink-0 items-center gap-3"><StatusPill status={entry.status} /><time className="hidden text-[10px] text-muted-foreground sm:block">{formatDate(entry.date)} UTC</time></div></div>)}</div>}</Surface>}
  </section>;
}
