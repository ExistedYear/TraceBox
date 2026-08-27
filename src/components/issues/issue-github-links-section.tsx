"use client";

import { useState } from "react";
import { ExternalLink, Github, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { humanizeEnum } from "@/lib/issues";

export type GithubLink = {
  id: string;
  repo_name: string;
  link_type: string;
  number: number | null;
  url: string;
  title: string | null;
  status: string;
};

type Props = { issueId: string; projectId: string; canEdit: boolean; initialLinks: GithubLink[] };

export function IssueGithubLinksSection({ issueId, projectId, canEdit, initialLinks }: Props) {
  const [links, setLinks] = useState(initialLinks);
  const [repo, setRepo] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("PULL_REQUEST");
  const [saving, setSaving] = useState(false);

  async function addLink() {
    if (!repo.trim() || !/^https:\/\/github\.com\//i.test(url.trim())) {
      toast.error("Enter a repository and GitHub URL.");
      return;
    }
    setSaving(true);
    try {
      const validation = await fetch("/api/github/validate-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue_id: issueId, project_id: projectId, link_type: type, repo_name: repo.trim(), url: url.trim() }) });
      if (!validation.ok) {
        const result = await validation.json().catch(() => null) as { error?: string } | null;
        toast.error(result?.error ?? "Could not verify GitHub item.");
        return;
      }
      const verified = await validation.json() as { repo_name: string; url: string; title: string; number: number | null; status: string };
      const { data, error } = await createClient().rpc("add_github_link", {
        p_issue_id: issueId,
        p_repo_name: verified.repo_name,
        p_link_type: type,
        p_url: verified.url,
        p_title: verified.title,
        p_status: verified.status,
        p_number: verified.number ?? undefined,
      });
      if (error) {
        toast.error("Could not add GitHub link.");
        return;
      }
      setLinks((current) => [...current, { id: String(data), repo_name: verified.repo_name, link_type: type, number: verified.number, url: verified.url, title: verified.title, status: verified.status }]);
      setRepo("");
      setUrl("");
      toast.success("GitHub link added.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function removeLink(link: GithubLink) {
    try {
      const { error } = await createClient().rpc("remove_github_link", { p_link_id: link.id });
      if (error) {
        toast.error("Could not remove GitHub link.");
        return;
      }
      setLinks((current) => current.filter((item) => item.id !== link.id));
      toast.success("GitHub link removed.");
    } catch {
      toast.error("Could not reach the server.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Github className="h-3.5 w-3.5" /> GitHub links</div>
      {links.length > 0 && <ul className="divide-y divide-border/60 rounded border border-border/70">{links.map((link) => <li key={link.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs"><div className="min-w-0"><a href={link.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-primary hover:underline">{link.title ?? `${link.repo_name}${link.number ? ` #${link.number}` : ""}`}</a><span className="text-[10px] text-muted-foreground">{link.repo_name} · {humanizeEnum(link.link_type)}{link.number ? ` #${link.number}` : ""}</span></div><span className="flex shrink-0 items-center gap-1.5"><span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] ${link.status === "MERGED" ? "border-purple-500/30 bg-purple-500/10 text-purple-300" : link.status === "CLOSED" ? "border-zinc-500/30 text-zinc-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>{humanizeEnum(link.status)}</span><ExternalLink className="h-3 w-3 text-muted-foreground" />{canEdit && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => void removeLink(link)} aria-label="Remove GitHub link"><Trash2 className="h-3 w-3" /></Button>}</span></li>)}</ul>}
      {canEdit && <fieldset className="min-w-0 space-y-2"><legend className="sr-only">Add GitHub link</legend><div className="space-y-1"><label htmlFor="github-link-type" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Link type</label><select id="github-link-type" aria-label="GitHub link type" className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs" value={type} onChange={(event) => setType(event.target.value)}><option value="PULL_REQUEST">Pull request</option><option value="COMMIT">Commit</option><option value="BRANCH">Branch</option></select></div><div className="space-y-1"><label htmlFor="github-link-repository" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Repository</label><Input id="github-link-repository" className="h-8 w-full min-w-0 text-xs" placeholder="owner/repository" value={repo} onChange={(event) => setRepo(event.target.value)} /></div><div className="space-y-1"><label htmlFor="github-link-url" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">GitHub URL</label><Input id="github-link-url" className="h-8 w-full min-w-0 text-xs" placeholder="https://github.com/..." value={url} onChange={(event) => setUrl(event.target.value)} /></div><p className="text-[10px] text-muted-foreground">GitHub verifies the repository and item before it is linked.</p><Button size="sm" className="h-8 w-full text-xs" onClick={() => void addLink()} disabled={saving}>{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verify and link GitHub item"}</Button></fieldset>}
    </div>
  );
}
