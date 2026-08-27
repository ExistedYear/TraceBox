"use client";

import { useState } from "react";
import { Github, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Props = { projectId: string; initialRepo: string | null; initialAutoResolve: boolean };

export function GithubIntegrationManager({ projectId, initialRepo, initialAutoResolve }: Props) {
  const [repo, setRepo] = useState(initialRepo ?? "");
  const [autoResolve, setAutoResolve] = useState(initialAutoResolve);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo.trim())) { toast.error("Use owner/repository format."); return; }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("upsert_github_integration", { p_project_id: projectId, p_repo_full_name: repo.trim(), p_auto_resolve_enabled: autoResolve });
      if (error) { toast.error("Could not save GitHub integration."); return; }
      toast.success("GitHub integration saved.");
    } catch { toast.error("Could not reach the server."); } finally { setSaving(false); }
  }
  async function remove() {
    setSaving(true);
    try {
      const { error } = await createClient().rpc("remove_github_integration", { p_project_id: projectId });
      if (error) { toast.error("Could not disconnect GitHub."); return; }
      setRepo(""); toast.success("GitHub integration disconnected.");
    } catch { toast.error("Could not reach the server."); } finally { setSaving(false); }
  }
  return <section className="space-y-4"><div className="flex items-center gap-2"><Github className="h-4 w-4 text-foreground" /><div><h2 className="text-sm font-semibold">GitHub repository</h2><p className="text-xs text-muted-foreground">Link commits and pull requests that mention issue keys.</p></div></div><div className="flex flex-wrap items-center gap-2"><label htmlFor="github-repository" className="sr-only">GitHub repository</label><Input id="github-repository" className="h-8 max-w-xs text-xs" placeholder="owner/repository" value={repo} onChange={(event) => setRepo(event.target.value)} /><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={autoResolve} onChange={(event) => setAutoResolve(event.target.checked)} /> Auto-resolve merged PRs</label><Button size="sm" className="h-8 text-xs" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Connect"}</Button>{repo && <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive" onClick={() => void remove()} disabled={saving}><Trash2 className="h-3 w-3" /> Disconnect</Button>}</div><p className="text-[11px] text-muted-foreground">After connecting, set a GitHub webhook to <code>/api/webhooks/github</code> with the same server-side <code>GITHUB_WEBHOOK_SECRET</code>.</p></section>;
}
