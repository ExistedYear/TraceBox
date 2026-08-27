"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { formatIssueKey, parseIssueKey } from "@/lib/issues";

type LinkItem = { id: string; source_issue_id: string; target_issue_id: string; relationship: string; target?: { issue_number: number; title: string } };
type Props = { issueId: string; projectId: string; projectKey: string; canEdit: boolean };
const RELATIONS = ["BLOCKS", "DEPENDS_ON", "DUPLICATE_OF", "RELATES_TO", "CAUSED_BY", "REGRESSION_OF"] as const;

export function IssueLinksSection({ issueId, projectId, projectKey, canEdit }: Props) {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [targetKey, setTargetKey] = useState("");
  const [relation, setRelation] = useState<string>("RELATES_TO");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.from("issue_links").select("*").eq("source_issue_id", issueId);
        if (error) throw error;
        const targetIds = (data ?? []).map((link: any) => link.target_issue_id);
        const { data: targetRows, error: targetError } = targetIds.length ? await supabase.from("issues").select("id, issue_number, title").in("id", targetIds) : { data: [], error: null };
        if (targetError) throw targetError;
        const targetMap = new Map((targetRows ?? []).map((issue: any) => [issue.id, issue]));
        if (current) setLinks((data ?? []).map((link: any) => ({ ...link, target: targetMap.get(link.target_issue_id) })));
      } catch {
        if (current) setLoadError(true);
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [issueId]);

  async function handleAdd() {
    const parsed = parseIssueKey(targetKey);
    if (!parsed || parsed.projectKey !== projectKey) {
      toast.error(`Enter an issue key from ${projectKey}, such as ${projectKey}-42.`);
      return;
    }
    setAdding(true);
    try {
      const supabase = createClient();
      const { data: target, error: targetError } = await supabase.from("issues").select("id, issue_number, title").eq("project_id", projectId).eq("issue_number", parsed.issueNumber).maybeSingle();
      if (targetError || !target) {
        toast.error("Target issue not found in this project.");
        return;
      }
      if (target.id === issueId) {
        toast.error("An issue cannot link to itself.");
        return;
      }
      const { data, error } = await supabase.rpc("add_issue_link", { p_source_issue_id: issueId, p_target_issue_id: target.id, p_relationship: relation });
      if (error) {
        toast.error("Could not create link.");
        return;
      }
      setLinks((current) => [...current, { id: String(data), source_issue_id: issueId, target_issue_id: target.id, relationship: relation, target: target as { issue_number: number; title: string } }]);
      setTargetKey("");
      toast.success("Link created.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      const { error } = await createClient().rpc("remove_issue_link", { p_link_id: id });
      if (error) {
        toast.error("Could not remove link.");
        return;
      }
      setLinks((current) => current.filter((link) => link.id !== id));
      toast.success("Link removed.");
    } catch {
      toast.error("Could not reach the server.");
    }
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading links...</p>;
  if (loadError) return <p className="text-xs text-destructive">Could not load linked issues.</p>;
  return <div className="space-y-3">
    {links.length === 0 ? <p className="text-xs text-muted-foreground">No linked issues.</p> : <ul className="space-y-1.5">{links.map((link) => <li key={link.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs"><span className="flex min-w-0 items-center gap-2"><Link2 className="h-3 w-3 shrink-0 text-muted-foreground" /><span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase">{link.relationship.replace(/_/g, " ")}</span><ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />{link.target ? <Link href={`/dashboard/issues/${formatIssueKey(projectKey, link.target.issue_number)}`} className="truncate font-medium text-primary hover:underline">{formatIssueKey(projectKey, link.target.issue_number)} {link.target.title && `· ${link.target.title}`}</Link> : <span className="font-mono text-muted-foreground">{link.target_issue_id.slice(0, 8)}</span>}</span>{canEdit && <Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => void handleRemove(link.id)} aria-label="Remove link"><Unlink className="h-3 w-3" /></Button>}</li>)}</ul>}
    {canEdit && <div className="flex flex-col gap-2 sm:flex-row"><label htmlFor="issue-link-relation" className="sr-only">Link relationship</label><select id="issue-link-relation" aria-label="Link relationship" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={relation} onChange={(event) => setRelation(event.target.value)}>{RELATIONS.map((item) => <option key={item}>{item.replace(/_/g, " ")}</option>)}</select><label htmlFor="issue-link-target" className="sr-only">Target issue key</label><Input id="issue-link-target" placeholder="issue key (e.g. KEY-42)" value={targetKey} onChange={(event) => setTargetKey(event.target.value.toUpperCase())} className="h-8 flex-1 font-mono text-xs" /><Button size="sm" className="h-8 gap-1 text-xs" onClick={() => void handleAdd()} disabled={adding}>{adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Link</Button></div>}
  </div>;
}
