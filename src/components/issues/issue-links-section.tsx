"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2, Loader2, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { formatIssueKey } from "@/lib/issues";

type LinkItem = {
  id: string;
  source_issue_id: string;
  target_issue_id: string;
  relationship: string;
  target?: { issue_number: number; title: string; key?: string };
};

type Props = {
  issueId: string;
  projectId: string;
  projectKey: string;
  canEdit: boolean;
};

const RELATIONS = ["BLOCKS", "DEPENDS_ON", "DUPLICATE_OF", "RELATES_TO", "CAUSED_BY", "REGRESSION_OF"] as const;

export function IssueLinksSection({ issueId, projectId, projectKey, canEdit }: Props) {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetKey, setTargetKey] = useState("");
  const [relation, setRelation] = useState<string>("RELATES_TO");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("issue_links").select("*").eq("source_issue_id", issueId);
      if (data) {
        // Fetch target titles
        const targetIds = data.map((l: any) => l.target_issue_id);
        let targetMap = new Map<string, any>();
        if (targetIds.length > 0) {
          const { data: issues } = await supabase.from("issues").select("id, issue_number, title").in("id", targetIds);
          targetMap = new Map((issues ?? []).map((i: any) => [i.id, i]));
        }
        setLinks(
          data.map((l: any) => ({
            ...l,
            target: targetMap.get(l.target_issue_id),
          })),
        );
      }
      setLoading(false);
    })();
  }, [issueId]);

  async function handleAdd() {
    const parsed = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(targetKey.trim());
    if (!parsed) {
      toast.error("Enter a valid issue key like AUTH-42.");
      return;
    }
    setAdding(true);
    try {
      const supabase = createClient();
      // Resolve target issue id
      const { data: targetIssue } = await supabase
        .from("issues")
        .select("id")
        .eq("project_id", projectId)
        .eq("issue_number", Number(parsed[2]))
        .maybeSingle();
      if (!targetIssue) {
        toast.error("Target issue not found in this project.");
        return;
      }
      const { data, error } = await supabase.rpc("add_issue_link", {
        p_source_issue_id: issueId,
        p_target_issue_id: targetIssue.id,
        p_relationship: relation,
      });
      if (error) {
        toast.error("Could not create link.");
        return;
      }
      toast.success("Link created.");
      setTargetKey("");
      // Append locally
      setLinks((prev) => [
        ...prev,
        {
          id: String(data),
          source_issue_id: issueId,
          target_issue_id: targetIssue.id,
          relationship: relation,
          target: { issue_number: Number(parsed[2]), title: "" },
        },
      ]);
    } catch {
      toast.error("Could not reach server.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(linkId: string) {
    try {
      const { error } = await createClient().rpc("remove_issue_link", { p_link_id: linkId });
      if (error) {
        toast.error("Could not remove link.");
        return;
      }
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      toast.success("Link removed.");
    } catch {
      toast.error("Could not reach server.");
    }
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading links...</p>;

  return (
    <div className="space-y-3">
      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground">No linked issues.</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs">
              <span className="flex items-center gap-2">
                <Link2 className="h-3 w-3 text-muted-foreground" />
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">{link.relationship.replace(/_/g, " ")}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                {link.target ? (
                  <Link href={`/dashboard/issues/${formatIssueKey(projectKey, link.target.issue_number)}`} className="font-medium text-primary hover:underline">
                    {formatIssueKey(projectKey, link.target.issue_number)} {link.target.title && `· ${link.target.title}`}
                  </Link>
                ) : (
                  <span className="font-mono text-muted-foreground">{link.target_issue_id.slice(0, 8)}</span>
                )}
              </span>
              {canEdit && (
                <button type="button" onClick={() => void handleRemove(link.id)} className="p-1 text-muted-foreground hover:text-destructive" aria-label="Remove link">
                  <Unlink className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={relation} onChange={(e) => setRelation(e.target.value)}>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </select>
          <Input placeholder="issue key (e.g. KEY-42)" value={targetKey} onChange={(e) => setTargetKey(e.target.value.toUpperCase())} className="h-8 flex-1 font-mono text-xs" />
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => void handleAdd()} disabled={adding}>
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Link
          </Button>
        </div>
      )}
    </div>
  );
}
