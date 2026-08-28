"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, CircleCheck, CircleX, ExternalLink, Github, GitPullRequest, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { humanizeEnum } from "@/lib/issues";
import { createClient } from "@/lib/supabase/client";

export type GithubCheck = { id: number; name: string; status: string; conclusion: string | null; html_url: string | null };
export type GithubCheckSummary = { state: string; total_count: number; completed_count: number; successful_count: number; failed_count: number; pending_count: number; checks: GithubCheck[]; last_synced_at?: string | null; error?: string | null };
export type GithubLink = {
  id: string;
  repo_name: string;
  link_type: string;
  number: number | null;
  url: string;
  title: string | null;
  status: string;
  github_artifact_id?: string | null;
  relationship?: string | null;
  source?: string | null;
  github_artifact?: {
    head_branch: string | null;
    base_branch: string | null;
    author_login: string | null;
    head_sha: string | null;
    draft: boolean;
    merged: boolean;
    state: string | null;
    github_updated_at: string | null;
    last_synced_at: string | null;
    github_pr_check_summaries?: GithubCheckSummary | GithubCheckSummary[] | null;
  } | null;
};

type Repository = { id: string; full_name: string; private: boolean; archived: boolean; is_accessible: boolean };
type PullRequest = { github_id: number; number: number; title: string; state: string; draft: boolean; merged: boolean; author_login: string | null; head_branch: string | null; base_branch: string | null; head_sha: string | null; html_url: string; updated_at: string };
type Props = { issueId: string; projectId: string; canEdit: boolean; initialLinks: GithubLink[] };

function checkSummary(link: GithubLink) {
  const summary = link.github_artifact?.github_pr_check_summaries;
  return Array.isArray(summary) ? summary[0] ?? null : summary ?? null;
}

function stateClasses(state: string) {
  if (state === "MERGED") return "border-purple-500/30 bg-purple-500/10 text-purple-300";
  if (state === "CLOSED") return "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
  if (state === "DRAFT") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
}

function CheckSummary({ summary }: { summary: GithubCheckSummary | null }) {
  if (!summary) return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CircleAlert className="h-3 w-3" /> Checks not synced</span>;
  if (summary.state === "FAILURE") return <span className="inline-flex items-center gap-1 text-[10px] text-red-300"><CircleX className="h-3 w-3" /> {summary.failed_count} failed · {summary.completed_count}/{summary.total_count} complete</span>;
  if (summary.state === "PENDING") return <span className="inline-flex items-center gap-1 text-[10px] text-amber-300"><Loader2 className="h-3 w-3 animate-spin" /> {summary.completed_count}/{summary.total_count} checks complete</span>;
  if (summary.state === "NONE") return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CircleAlert className="h-3 w-3" /> No checks reported</span>;
  if (summary.state === "UNKNOWN") return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CircleAlert className="h-3 w-3" /> Checks unavailable</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300"><CircleCheck className="h-3 w-3" /> {summary.successful_count}/{summary.total_count} checks passed</span>;
}

export function IssueGithubLinksSection({ issueId, projectId, canEdit, initialLinks }: Props) {
  const [links, setLinks] = useState(initialLinks);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("open");
  const [relationship, setRelationship] = useState("REFERENCES");
  const [loadingRepositories, setLoadingRepositories] = useState(true);
  const [loadingPullRequests, setLoadingPullRequests] = useState(false);
  const [linkingNumber, setLinkingNumber] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [url, setUrl] = useState("");
  const [manualType, setManualType] = useState("PULL_REQUEST");
  const [savingManual, setSavingManual] = useState(false);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    void fetch(`/api/github/repositories?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ repositories: Repository[]; bindings: Array<{ github_repository_id: string }> }> : null)
      .then((data) => {
        if (!active || !data) return;
        const boundIds = new Set(data.bindings.map((binding) => binding.github_repository_id));
        const available = data.repositories.filter((item) => boundIds.has(item.id) && item.is_accessible && !item.archived);
        setRepositories(available);
        setSelectedRepositoryId((current) => current || data.bindings.find((binding) => available.some((item) => item.id === binding.github_repository_id))?.github_repository_id || available[0]?.id || "");
      })
      .catch(() => { if (active) toast.error("Could not load connected GitHub repositories."); })
      .finally(() => { if (active) setLoadingRepositories(false); });
    return () => { active = false; };
  }, [canEdit, projectId]);

  useEffect(() => {
    if (!selectedRepositoryId || !canEdit) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingPullRequests(true);
      const params = new URLSearchParams({ project_id: projectId, repository_id: selectedRepositoryId, state, q: search });
      void fetch(`/api/github/pull-requests?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const data = await response.json().catch(() => null) as { pull_requests?: PullRequest[]; error?: string } | null;
          if (!response.ok) throw new Error(data?.error ?? "Could not load pull requests.");
          setPullRequests(data?.pull_requests ?? []);
        })
        .catch((error) => { if (error instanceof Error && error.name !== "AbortError") toast.error(error.message); })
        .finally(() => { if (!controller.signal.aborted) setLoadingPullRequests(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canEdit, projectId, search, selectedRepositoryId, state]);

  async function linkPullRequest(pullRequest: PullRequest) {
    if (linkingNumber !== null) return;
    setLinkingNumber(pullRequest.number);
    try {
      const response = await fetch("/api/github/link-pull-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue_id: issueId, project_id: projectId, repository_id: selectedRepositoryId, number: pullRequest.number, relationship }) });
      const data = await response.json().catch(() => null) as (PullRequest & { link_id: string; artifact_id: string; repository: string; url: string; checks: GithubCheckSummary | null; relationship: string }) | { error?: string } | null;
      if (!response.ok || !data || !("link_id" in data)) throw new Error((data as { error?: string } | null)?.error ?? "Could not link pull request.");
      setLinks((current) => [{ id: data.link_id, repo_name: data.repository, link_type: "PULL_REQUEST", number: data.number, url: data.url, title: data.title, status: data.merged ? "MERGED" : data.state, relationship: data.relationship, source: "MANUAL", github_artifact_id: data.artifact_id, github_artifact: { head_branch: data.head_branch, base_branch: data.base_branch, author_login: data.author_login, head_sha: data.head_sha, draft: data.draft, merged: data.merged, state: data.state, github_updated_at: data.updated_at, last_synced_at: new Date().toISOString(), github_pr_check_summaries: data.checks } }, ...current.filter((link) => link.id !== data.link_id && !(link.github_artifact_id === data.artifact_id && link.relationship === data.relationship))]);
      toast.success(`PR #${pullRequest.number} linked.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not link pull request."); } finally { setLinkingNumber(null); }
  }

  async function addManualLink() {
    if (!repo.trim() || !/^https:\/\/github\.com\//i.test(url.trim())) { toast.error("Enter a repository and GitHub URL."); return; }
    setSavingManual(true);
    try {
      const validation = await fetch("/api/github/validate-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue_id: issueId, project_id: projectId, link_type: manualType, repo_name: repo.trim(), url: url.trim() }) });
      if (!validation.ok) { const result = await validation.json().catch(() => null) as { error?: string } | null; throw new Error(result?.error ?? "Could not verify GitHub item."); }
      const verified = await validation.json() as { repo_name: string; url: string; title: string; number: number | null; status: string };
      const { data, error } = await createClient().rpc("add_github_link", { p_issue_id: issueId, p_repo_name: verified.repo_name, p_link_type: manualType, p_url: verified.url, p_title: verified.title, p_status: verified.status, p_number: verified.number ?? undefined });
      if (error) throw new Error("Could not add GitHub link.");
      setLinks((current) => [...current, { id: String(data), repo_name: verified.repo_name, link_type: manualType, number: verified.number, url: verified.url, title: verified.title, status: verified.status, relationship: "REFERENCES", source: "MANUAL" }]);
      setRepo(""); setUrl(""); setManualOpen(false); toast.success("GitHub link added.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not reach the server."); } finally { setSavingManual(false); }
  }

  async function removeLink(link: GithubLink) {
    const { error } = await createClient().rpc("remove_github_link", { p_link_id: link.id });
    if (error) { toast.error("Could not remove GitHub link."); return; }
    setLinks((current) => current.filter((item) => item.id !== link.id));
    toast.success("GitHub link removed.");
  }

  const boundRepositoryLabel = useMemo(() => repositories.find((repository) => repository.id === selectedRepositoryId)?.full_name ?? "No repository connected", [repositories, selectedRepositoryId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Github className="h-3.5 w-3.5" /> Development</div>
        {links.length > 0 && <span className="rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{links.length}</span>}
      </div>

      {links.length > 0 ? <ul className="space-y-2">
        {links.map((link) => {
          const artifact = link.github_artifact;
          const summary = checkSummary(link);
          const currentState = artifact?.merged || link.status === "MERGED" ? "MERGED" : artifact?.draft || link.status === "DRAFT" ? "DRAFT" : artifact?.state?.toUpperCase() || link.status;
          return <li key={link.id} className="rounded-[10px] border border-border/70 bg-card/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><a href={link.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-primary hover:underline"><GitPullRequest className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{link.title ?? `${link.repo_name}${link.number ? ` #${link.number}` : ""}`}</span></a><p className="mt-1 truncate text-[10px] text-muted-foreground">{link.repo_name}{link.number ? ` · #${link.number}` : ""}{link.relationship && <span> · {humanizeEnum(link.relationship)}</span>}</p></div>
              <div className="flex shrink-0 items-center gap-1.5"><span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] ${stateClasses(currentState)}`}>{humanizeEnum(currentState)}</span>{canEdit && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => void removeLink(link)} aria-label="Remove GitHub link"><Trash2 className="h-3 w-3" /></Button>}</div>
            </div>
            {artifact && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">{artifact.head_branch && artifact.base_branch && <span className="inline-flex items-center gap-1 font-mono"><span className="max-w-[120px] truncate">{artifact.head_branch}</span><span>→</span><span>{artifact.base_branch}</span></span>}{artifact.author_login && <span>{artifact.author_login}</span>}<CheckSummary summary={summary} /><a href={link.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">Open <ExternalLink className="h-3 w-3" /></a></div>}
          </li>;
        })}
      </ul> : null}

      {canEdit ? <div className="space-y-3 rounded-[10px] border border-border/70 p-3">
        <div className="flex items-center justify-between gap-2"><div><h3 className="text-xs font-semibold">Link a pull request</h3><p className="mt-0.5 text-[10px] text-muted-foreground">Search connected repositories and select a PR. GitHub verifies the final data.</p></div><GitPullRequest className="h-4 w-4 text-muted-foreground" /></div>
        {loadingRepositories ? <p className="text-xs text-muted-foreground">Loading connected repositories…</p> : repositories.length === 0 ? <p className="text-xs text-muted-foreground">No active repository is bound. Connect one in <a className="text-primary hover:underline" href="/dashboard/settings/integrations">Settings → Integrations</a>.</p> : <>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"><label htmlFor="github-pr-repository" className="sr-only">Repository</label><select id="github-pr-repository" className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs" value={selectedRepositoryId} onChange={(event) => setSelectedRepositoryId(event.target.value)}>{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.full_name}{repository.private ? " · private" : ""}</option>)}</select><span className="hidden text-[10px] text-muted-foreground sm:block">{boundRepositoryLabel}</span></div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><label className="relative block"><span className="sr-only">Search pull requests</span><Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" placeholder="Search title, number, or author" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="flex gap-2"><label htmlFor="github-pr-state" className="sr-only">Pull request state</label><select id="github-pr-state" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={state} onChange={(event) => setState(event.target.value)}><option value="open">Open</option><option value="all">All states</option><option value="closed">Closed</option></select><label htmlFor="github-pr-relationship" className="sr-only">Relationship</label><select id="github-pr-relationship" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={relationship} onChange={(event) => setRelationship(event.target.value)}><option value="REFERENCES">References</option><option value="FIXES">Fixes</option><option value="IMPLEMENTS">Implements</option></select></div></div>
          {loadingPullRequests ? <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching GitHub…</div> : pullRequests.length === 0 ? <p className="py-2 text-xs text-muted-foreground">No pull requests matched this search.</p> : <ul className="max-h-60 divide-y divide-border/60 overflow-y-auto rounded border border-border/70">{pullRequests.map((pullRequest) => <li key={pullRequest.github_id} className="flex items-center gap-3 px-2.5 py-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">#{pullRequest.number} {pullRequest.title}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{pullRequest.author_login ?? "Unknown author"} · {pullRequest.head_branch ?? "?"} → {pullRequest.base_branch ?? "?"}</p></div><span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] ${stateClasses(pullRequest.merged ? "MERGED" : pullRequest.draft ? "DRAFT" : pullRequest.state)}`}>{pullRequest.merged ? "Merged" : pullRequest.draft ? "Draft" : humanizeEnum(pullRequest.state)}</span><Button type="button" size="sm" className="h-7 px-2 text-[10px]" onClick={() => void linkPullRequest(pullRequest)} disabled={linkingNumber !== null}>{linkingNumber === pullRequest.number ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3" /> Link</>}</Button></li>)}</ul>}
        </>}
      </div> : null}

      {canEdit ? <details open={manualOpen} onToggle={(event) => setManualOpen((event.currentTarget as HTMLDetailsElement).open)} className="rounded-[10px] border border-dashed border-border/70 px-3 py-2"><summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Advanced: link by GitHub URL</summary><fieldset className="mt-3 min-w-0 space-y-2"><div className="grid gap-2 sm:grid-cols-3"><label className="space-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type<select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-normal normal-case tracking-normal text-foreground" value={manualType} onChange={(event) => setManualType(event.target.value)}><option value="PULL_REQUEST">Pull request</option><option value="COMMIT">Commit</option><option value="BRANCH">Branch</option></select></label><label className="space-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:col-span-2">Repository<Input className="mt-1 h-8 w-full text-xs" placeholder="owner/repository" value={repo} onChange={(event) => setRepo(event.target.value)} /></label></div><label className="block space-y-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">GitHub URL<Input className="mt-1 h-8 w-full text-xs" placeholder="https://github.com/..." value={url} onChange={(event) => setUrl(event.target.value)} /></label><Button size="sm" className="h-8 w-full text-xs" onClick={() => void addManualLink()} disabled={savingManual}>{savingManual ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verify and link URL"}</Button></fieldset></details> : null}
    </div>
  );
}
