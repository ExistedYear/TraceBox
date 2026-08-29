"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Github, Link2, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Installation = {
  id: string;
  github_installation_id: number;
  github_account_login: string;
  github_account_type: string;
  status: string;
  permissions: Record<string, string>;
  last_verified_at: string | null;
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
};

type Props = {
  projectId: string;
  canManage: boolean;
  initialLegacyRepo: string | null;
  initialInstallations: Installation[];
  initialRepositories: Repository[];
  initialBindings: Binding[];
};

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (character) => character.toUpperCase());
}

export function GithubIntegrationManager({ projectId, canManage, initialLegacyRepo, initialInstallations, initialRepositories, initialBindings }: Props) {
  const [installations, setInstallations] = useState(initialInstallations);
  const [repositories, setRepositories] = useState(initialRepositories);
  const [bindings, setBindings] = useState(initialBindings);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(initialRepositories.find((repository) => initialBindings.some((binding) => binding.github_repository_id === repository.id))?.id ?? "");
  const initialBinding = initialBindings.find((binding) => binding.github_repository_id === selectedRepositoryId) ?? initialBindings.find((binding) => binding.is_primary);
  const [autoResolve, setAutoResolve] = useState(initialBinding?.auto_resolve_enabled ?? true);
  const [targetBranches, setTargetBranches] = useState((initialBinding?.target_branches ?? ["main"]).join(", "));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("github");
    if (result === "connected") toast.success("GitHub App connected. Choose a repository below.");
    if (result === "pending") toast.info("GitHub installation is waiting for organization approval.");
    if (result === "error") toast.error("GitHub could not be connected. Check the App configuration and try again.");
    if (result) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const activeInstallationIds = useMemo(() => new Set(installations.filter((installation) => installation.status === "ACTIVE").map((installation) => installation.id)), [installations]);
  const availableRepositories = useMemo(() => repositories.filter((repository) => activeInstallationIds.has(repository.installation_id) && repository.is_accessible && !repository.archived), [activeInstallationIds, repositories]);

  function selectRepository(repositoryId: string) {
    setSelectedRepositoryId(repositoryId);
    const binding = bindings.find((item) => item.github_repository_id === repositoryId);
    setAutoResolve(binding?.auto_resolve_enabled ?? true);
    setTargetBranches((binding?.target_branches ?? ["main"]).join(", "));
  }

  async function reload() {
    const response = await fetch(`/api/github/repositories?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not reload GitHub repositories.");
    const data = await response.json() as { installations: Installation[]; repositories: Repository[]; bindings: Binding[] };
    setInstallations(data.installations);
    setRepositories(data.repositories);
    setBindings(data.bindings);
    setSelectedRepositoryId(data.repositories.find((repository) => data.bindings.some((binding) => binding.github_repository_id === repository.id))?.id ?? "");
  }

  async function refreshRepositories() {
    if (busy || !canManage) return;
    setBusy(true);
    try {
      const response = await fetch("/api/github/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId }) });
      if (!response.ok) throw new Error("Could not refresh GitHub repositories.");
      await reload();
      toast.success("GitHub repositories refreshed.");
    } catch { toast.error("Could not refresh GitHub repositories."); } finally { setBusy(false); }
  }

  async function bindRepository() {
    if (busy || !canManage || !selectedRepositoryId) return;
    const branches = targetBranches.split(",").map((branch) => branch.trim()).filter(Boolean);
    if (!branches.length) { toast.error("Add at least one target branch."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/github/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: selectedRepositoryId, is_primary: false, auto_resolve_enabled: autoResolve, target_branches: branches }) });
      if (!response.ok) throw new Error("Could not connect repository.");
      await reload();
      toast.success("GitHub repository connected.");
    } catch { toast.error("Could not connect GitHub repository."); } finally { setBusy(false); }
  }

  async function saveAutomation() {
    if (busy || !canManage || !selectedRepositoryId) return;
    const branches = targetBranches.split(",").map((branch) => branch.trim()).filter(Boolean);
    if (!branches.length) { toast.error("Add at least one target branch."); return; }
    if (!bindings.some((binding) => binding.github_repository_id === selectedRepositoryId)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/github/bind", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: selectedRepositoryId, auto_resolve_enabled: autoResolve, target_branches: branches }) });
      if (!response.ok) throw new Error("Could not save automation settings.");
      await reload();
      toast.success("GitHub automation settings saved.");
    } catch { toast.error("Could not save GitHub automation settings."); } finally { setBusy(false); }
  }

  async function setPrimaryRepository(repositoryId: string) {
    if (busy || !canManage) return;
    setBusy(true);
    try {
      const response = await fetch("/api/github/primary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: repositoryId }) });
      if (!response.ok) throw new Error("Could not set the primary repository.");
      await reload();
      toast.success("Primary repository updated.");
    } catch { toast.error("Could not set the primary repository."); } finally { setBusy(false); }
  }

  async function unbindRepository(repositoryId: string) {
    if (busy || !canManage || !window.confirm("Disconnect this GitHub repository from the project? Historical links will remain.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/github/bind", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, github_repository_id: repositoryId }) });
      if (!response.ok) throw new Error("Could not disconnect repository.");
      await reload();
      toast.success("GitHub repository disconnected.");
    } catch { toast.error("Could not disconnect GitHub repository."); } finally { setBusy(false); }
  }

  return <section className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Github className="h-4 w-4 text-foreground" /><div><h2 className="text-sm font-semibold">GitHub App</h2><p className="text-xs text-muted-foreground">Connect verified repositories without granting TraceBox access to your GitHub password.</p></div></div><div className="flex flex-wrap gap-2">{canManage && <Button asChild size="sm" className="h-8 gap-1 text-xs"><a href={`/api/github/connect?project_id=${encodeURIComponent(projectId)}`}><Github className="h-3.5 w-3.5" /> Connect GitHub</a></Button>}{canManage && <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => void refreshRepositories()} disabled={busy || !installations.length}><RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh</Button>}</div></div>
    {installations.length === 0 ? <div className="rounded-[10px] border border-dashed border-border/80 p-4 text-xs text-muted-foreground"><p className="font-medium text-foreground">No GitHub App installation found.</p><p className="mt-1">Connect GitHub to choose repositories from your account or organization. GitHub organization owners may need to approve the installation.</p>{initialLegacyRepo && <p className="mt-2 text-amber-300">Legacy mapping detected for <code className="font-mono">{initialLegacyRepo}</code>; reconnect it to verify access through GitHub.</p>}</div> : <div className="space-y-2">{installations.map((installation) => <div key={installation.id} className="rounded-[10px] border border-border/70 bg-card/50 p-3"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span><span className="font-medium">{installation.github_account_login}</span><span className="ml-2 text-muted-foreground">{installation.github_account_type}</span></span><span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${installation.status === "ACTIVE" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>{statusLabel(installation.status)}</span></div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{Object.entries(installation.permissions ?? {}).slice(0, 5).map(([permission, level]) => <span key={permission}>{permission}: {level}</span>)}{installation.last_verified_at && <span>verified {new Date(installation.last_verified_at).toLocaleString()}</span>}</div></div>)}</div>}
    {installations.length > 0 && <div className="space-y-3 rounded-[10px] border border-border/70 p-4"><div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project repositories</h3><p className="mt-1 text-[11px] text-muted-foreground">A project can use multiple repositories. The primary repository is explicit and will not change when another repository is connected.</p></div><div className="grid gap-2 md:grid-cols-[1fr_auto]"><label className="sr-only" htmlFor="github-repository-picker">GitHub repository</label><select id="github-repository-picker" className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs" value={selectedRepositoryId} onChange={(event) => selectRepository(event.target.value)}><option value="">Choose an accessible repository</option>{availableRepositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.full_name}{repository.private ? " · private" : ""}</option>)}</select><Button type="button" size="sm" className="h-8 gap-1 text-xs" onClick={() => void (bindings.some((binding) => binding.github_repository_id === selectedRepositoryId) ? saveAutomation() : bindRepository())} disabled={busy || !canManage || !selectedRepositoryId}>{bindings.some((binding) => binding.github_repository_id === selectedRepositoryId) ? <Save className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} {bindings.some((binding) => binding.github_repository_id === selectedRepositoryId) ? "Save automation" : "Connect repository"}</Button></div><div className="grid gap-3 sm:grid-cols-[1fr_1fr]"><label className="space-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Target branches<input disabled={!canManage} className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-normal normal-case tracking-normal text-foreground" value={targetBranches} onChange={(event) => setTargetBranches(event.target.value)} placeholder="main, release/*" /></label><label className="flex items-center gap-2 self-end pb-1 text-xs text-muted-foreground"><input type="checkbox" disabled={!canManage} checked={autoResolve} onChange={(event) => setAutoResolve(event.target.checked)} /> Resolve `Fixes KEY-123` only on these branches</label></div><ul className="divide-y divide-border/60 rounded border border-border/70">{bindings.length === 0 ? <li className="p-3 text-xs text-muted-foreground">No repositories connected to this project.</li> : bindings.map((binding) => { const repository = repositories.find((item) => item.id === binding.github_repository_id); return <li key={binding.github_repository_id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs"><span className="min-w-0"><span className="font-medium">{repository?.full_name ?? "Unavailable repository"}</span>{binding.is_primary && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">primary</span>}<span className="ml-2 text-[10px] text-muted-foreground">{binding.target_branches.join(", ")}</span></span><span className="flex items-center gap-2">{canManage && !binding.is_primary && <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-muted-foreground" onClick={() => void setPrimaryRepository(binding.github_repository_id)} disabled={busy}>Make primary</Button>}<a href={repository?.html_url} target="_blank" rel="noreferrer" className="text-primary hover:underline" aria-label={`Open ${repository?.full_name ?? "repository"}`}><ExternalLink className="h-3 w-3" /></a>{canManage && <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => void unbindRepository(binding.github_repository_id)} disabled={busy} aria-label={`Disconnect ${repository?.full_name ?? "repository"}`}><Trash2 className="h-3 w-3" /></Button>}</span></li>; })}</ul></div>}
    <div className="rounded-[10px] border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-muted-foreground"><p className="font-medium text-foreground">What GitHub access means</p><p className="mt-1">TraceBox reads repository metadata, pull requests, commits, and checks through the GitHub App. It does not request write access. Login with GitHub remains a separate identity flow.</p></div>
  </section>;
}
