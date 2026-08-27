"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Inbox, Keyboard, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { categoryClasses, formatIssueKey, parseIssueKey, personLabel } from "@/lib/issues";
import { cn } from "@/lib/utils";

export type TriageIssue = {
  id: string;
  issueNumber: number;
  keyLabel: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  severity: string;
  statusId: string;
  statusName: string;
  statusCategory: string;
  componentId: string | null;
  componentName: string | null;
  assigneeId: string | null;
  assigneeLabel: string;
  reporterId: string;
  reporterLabel: string;
  environment: string | null;
  stepsToReproduce: string | null;
  expectedBehavior: string | null;
  actualBehavior: string | null;
  createdAt: string;
  updatedAt: string;
};
type StateOption = { id: string; name: string; category: string };
type MemberOption = { userId: string; displayName: string | null };
type ComponentOption = { id: string; name: string };
type DuplicateCandidate = { issue_id: string; issue_number: number; title: string; similarity: number };
const TRIAGE_TYPES = ["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"];
const TRIAGE_PRIORITIES = ["P0", "P1", "P2", "P3", "P4"];
const TRIAGE_SEVERITIES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"];

type Props = {
  projectId: string;
  projectKey: string;
  issues: TriageIssue[];
  components: ComponentOption[];
  openStateId: string | null;
  closedStateId: string | null;
  members: MemberOption[];
  canManage: boolean;
};

export function TriageInbox({ projectId, projectKey, issues: initialIssues, openStateId, closedStateId, components, members, canManage }: Props) {

  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [targetDuplicateKey, setTargetDuplicateKey] = useState("");
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [findingDuplicates, setFindingDuplicates] = useState(false);
  const activeIssue = issues[selectedIndex] ?? null;

  useEffect(() => {
    if (!activeIssue) return;
    let current = true;
    const timer = setTimeout(() => {
      setFindingDuplicates(true);
      void (async () => {
        try {
          const { data } = await createClient().rpc("find_duplicate_candidates", { p_project_id: projectId, p_title: activeIssue.title, p_limit: 4 });
          if (current) setDuplicateCandidates((data ?? []).filter((candidate) => candidate.issue_id !== activeIssue.id));
        } catch {
          if (current) setDuplicateCandidates([]);
        } finally {
          if (current) setFindingDuplicates(false);
        }
      })();
    }, 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [activeIssue, projectId]);

  const removeActiveIssue = useCallback((id: string) => {
    setIssues((previous) => {
      const next = previous.filter((issue) => issue.id !== id);
      setSelectedIndex((index) => Math.min(index, Math.max(0, next.length - 1)));
      return next;
    });
  }, []);

  const transition = useCallback(async (stateId: string | null, resolution: string | undefined, action: string, success: string) => {
    if (!canManage || !activeIssue || !stateId) {
      toast.error(canManage ? "Required workflow state is unavailable." : "You do not have permission to triage issues.");
      return;
    }
    setLoadingAction(action);
    try {
      const { error } = await createClient().rpc("transition_issue", { p_issue_id: activeIssue.id, p_to_state_id: stateId, p_resolution: resolution });
      if (error) {
        toast.error("Could not update issue.");
        return;
      }
      toast.success(success);
      removeActiveIssue(activeIssue.id);
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setLoadingAction(null);
    }
  }, [activeIssue, canManage, removeActiveIssue, router]);

  async function classify(field: "type" | "priority" | "severity" | "component_id", value: string) {
    if (!canManage || !activeIssue || loadingAction) return;
    const updates = { [field]: field === "component_id" ? value || null : value };
    const previous = activeIssue;
    setLoadingAction(`classify-${field}`);
    try {
      const { error } = await createClient().rpc("update_issue_fields", { p_issue_id: previous.id, p_updates: updates });
      if (error) {
        toast.error("Could not update classification.");
        return;
      }
      setIssues((current) => current.map((issue) => issue.id === previous.id ? { ...issue, ...(field === "type" ? { type: value } : {}), ...(field === "priority" ? { priority: value } : {}), ...(field === "severity" ? { severity: value } : {}), ...(field === "component_id" ? { componentId: value || null, componentName: components.find((item) => item.id === value)?.name ?? null } : {}) } : issue));
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setLoadingAction(null);
    }
  }

  const handleConfirmDuplicate = async (candidateKey?: string) => {
    const key = (candidateKey ?? targetDuplicateKey).trim();
    const parsed = parseIssueKey(key);
    if (!canManage || !activeIssue || !closedStateId || !parsed || parsed.projectKey !== projectKey || parsed.issueNumber === activeIssue.issueNumber) {
      toast.error(`Enter another issue key from ${projectKey}, such as ${projectKey}-12.`);
      return;
    }
    setLoadingAction("duplicate");
    try {
      const supabase = createClient();
      const { data: target, error: lookupError } = await supabase.from("issues").select("id").eq("project_id", projectId).eq("issue_number", parsed.issueNumber).maybeSingle();
      if (lookupError || !target) {
        toast.error(`Target issue ${key} was not found.`);
        return;
      }
      const { error: linkError } = await supabase.rpc("add_issue_link", { p_source_issue_id: activeIssue.id, p_target_issue_id: target.id, p_relationship: "DUPLICATE_OF" });
      if (linkError) {
        toast.error("Could not link duplicate issue.");
        return;
      }
      toast.success(`${activeIssue.keyLabel} marked as duplicate of ${key}.`);
      setDuplicateModalOpen(false);
      setTargetDuplicateKey("");
      removeActiveIssue(activeIssue.id);
      router.refresh();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAssign = async (assigneeId: string) => {
    if (!canManage || !activeIssue) return;
    try {
      const { error } = await createClient().rpc("assign_issue", { p_issue_id: activeIssue.id, p_assignee_id: assigneeId || null });
      if (error) {
        toast.error("Could not assign issue.");
        return;
      }
      const member = members.find((item) => item.userId === assigneeId);
      setIssues((previous) => previous.map((issue) => issue.id === activeIssue.id ? { ...issue, assigneeId: assigneeId || null, assigneeLabel: personLabel(member?.displayName, assigneeId) } : issue));
      toast.success(`Assigned to ${member?.displayName ?? "engineer"}.`);
    } catch {
      toast.error("Could not reach the server.");
    }
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName) || duplicateModalOpen) return;
      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") setSelectedIndex((index) => Math.min(index + 1, Math.max(0, issues.length - 1)));
      else if (key === "k" || event.key === "ArrowUp") setSelectedIndex((index) => Math.max(0, index - 1));
      else if (canManage && key === "a" && !duplicateModalOpen) void transition(openStateId, undefined, "accept", `${activeIssue?.keyLabel ?? "Issue"} accepted.`);
      else if (canManage && key === "r" && !duplicateModalOpen) void transition(closedStateId, "WONT_FIX", "reject", `${activeIssue?.keyLabel ?? "Issue"} rejected.`);
      else if (canManage && key === "d" && !duplicateModalOpen) setDuplicateModalOpen(true);
      else if (key === "o" && activeIssue) router.push(`/dashboard/issues/${activeIssue.keyLabel}`);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIssue, canManage, closedStateId, duplicateModalOpen, issues.length, openStateId, router, transition]);

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-4">
        <div>
          <div className="flex items-center gap-2"><Inbox className="h-4 w-4 text-amber-400" /><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">{projectKey} · Triage Inbox</p></div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Triage & Classification</h1>
          <p className="mt-1 text-xs text-muted-foreground">Review incoming issues, identify duplicates, and classify work.</p>
        </div>
        <div className="hidden items-center gap-2 rounded-lg border border-border/70 px-3 py-1.5 font-mono text-[11px] text-muted-foreground sm:flex"><Keyboard className="h-3.5 w-3.5 text-primary" /><span>J/K navigate</span><span>A accept</span><span>R reject</span><span>D duplicate</span><span>O open</span></div>
      </div>

      {issues.length === 0 ? (
        <Surface className="p-12 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" /><h2 className="mt-3 text-base font-semibold">Triage inbox is clean</h2><p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">All incoming issues in {projectKey} have been reviewed.</p></Surface>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <Surface className="overflow-hidden"><div className="flex items-center justify-between border-b border-border/80 px-3.5 py-2.5"><span className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unreviewed Queue ({issues.length})</span><span className="font-mono text-[10px] text-amber-400">{selectedIndex + 1} of {issues.length}</span></div><div className="max-h-[calc(100vh-280px)] divide-y divide-border/60 overflow-y-auto">{issues.map((issue, index) => <button key={issue.id} type="button" onClick={() => setSelectedIndex(index)} className={cn("flex w-full flex-col gap-1 p-3 text-left", index === selectedIndex ? "border-l-2 border-primary bg-primary/10" : "hover:bg-muted/40")}><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-semibold text-primary">{issue.keyLabel}</span><span className={cn("rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase", categoryClasses(issue.statusCategory))}>{issue.severity}</span></div><p className="truncate text-xs font-medium">{issue.title}</p><span className="font-mono text-[10px] text-muted-foreground/70">{issue.type} · {issue.componentName ?? "No component"}</span></button>)}</div></Surface>

          {activeIssue && <div className="space-y-4"><Surface className="p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void transition(openStateId, undefined, "accept", `${activeIssue.keyLabel} accepted.`)} disabled={!canManage || loadingAction !== null} className="h-8 gap-1.5 bg-emerald-600 text-xs text-white"><CheckCircle2 className="h-3.5 w-3.5" />Accept (A)</Button><Button size="sm" variant="outline" onClick={() => setDuplicateModalOpen(true)} disabled={!canManage || loadingAction !== null} className="h-8 gap-1.5 text-xs text-amber-400"><Copy className="h-3.5 w-3.5" />Duplicate (D)</Button><Button size="sm" variant="ghost" onClick={() => void transition(closedStateId, "WONT_FIX", "reject", `${activeIssue.keyLabel} rejected.`)} disabled={!canManage || loadingAction !== null} className="h-8 gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" />Reject (R)</Button></div><div className="flex items-center gap-2"><select aria-label="Assign engineer" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={activeIssue.assigneeId ?? ""} onChange={(event) => void handleAssign(event.target.value)} disabled={!canManage}><option value="">Assign engineer...</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName ?? member.userId.slice(0, 8)}</option>)}</select><Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs"><Link href={`/dashboard/issues/${activeIssue.keyLabel}`} target="_blank">Open <ExternalLink className="h-3 w-3" /></Link></Button></div></div></Surface>
            <Surface className="p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Inline classification</p>
              <div className="grid gap-2 sm:grid-cols-4">
                <select aria-label="Issue type" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={activeIssue.type} onChange={(event) => void classify("type", event.target.value)} disabled={!canManage || loadingAction !== null}>{TRIAGE_TYPES.map((value) => <option key={value}>{value}</option>)}</select>
                <select aria-label="Issue priority" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={activeIssue.priority} onChange={(event) => void classify("priority", event.target.value)} disabled={!canManage || loadingAction !== null}>{TRIAGE_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>
                <select aria-label="Issue severity" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={activeIssue.severity} onChange={(event) => void classify("severity", event.target.value)} disabled={!canManage || loadingAction !== null}>{TRIAGE_SEVERITIES.map((value) => <option key={value}>{value}</option>)}</select>
                <select aria-label="Issue component" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={activeIssue.componentId ?? ""} onChange={(event) => void classify("component_id", event.target.value)} disabled={!canManage || loadingAction !== null}><option value="">No component</option>{components.map((component) => <option key={component.id} value={component.id}>{component.name}</option>)}</select>
              </div>
            </Surface>

            {findingDuplicates ? <div className="flex items-center gap-2 rounded-lg border border-border/70 p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />Scanning for similar issues...</div> : duplicateCandidates.length > 0 ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"><div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />Possible duplicates</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{duplicateCandidates.map((candidate) => <div key={candidate.issue_id} className="flex items-center justify-between gap-2 rounded border border-amber-500/20 bg-background/80 p-2 text-xs"><div className="min-w-0"><span className="font-mono font-semibold text-primary">{formatIssueKey(projectKey, candidate.issue_number)}</span><p className="truncate text-muted-foreground">{candidate.title}</p></div><Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void handleConfirmDuplicate(formatIssueKey(projectKey, candidate.issue_number))} disabled={!canManage}>Mark duplicate</Button></div>)}</div></div> : null}

            <Surface className="p-4 sm:p-5"><div className="mb-4 border-b border-border/70 pb-3"><span className="font-mono text-xs font-semibold text-primary">{activeIssue.keyLabel}</span><h2 className="text-lg font-semibold">{activeIssue.title}</h2><div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-muted-foreground"><span>{activeIssue.type}</span><span>{activeIssue.priority}</span><span>{activeIssue.severity}</span><span>{activeIssue.componentName ?? "No component"}</span></div></div><div className="grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-card/40 p-3 text-xs sm:grid-cols-4"><div><span className="text-muted-foreground">Reporter</span><p className="font-medium">{activeIssue.reporterLabel}</p></div><div><span className="text-muted-foreground">Assignee</span><p className="font-medium">{activeIssue.assigneeLabel}</p></div><div><span className="text-muted-foreground">Created</span><p className="font-medium">{new Date(activeIssue.createdAt).toLocaleDateString()}</p></div><div><span className="text-muted-foreground">Status</span><p className="font-medium">{activeIssue.statusName}</p></div></div><div className="mt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3><p className="mt-1 whitespace-pre-wrap rounded border border-border/60 bg-background/50 p-3 text-xs leading-relaxed">{activeIssue.description ?? "No description provided."}</p></div>{activeIssue.environment && <div className="mt-4"><h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Environment</h3><p className="mt-1 font-mono text-xs text-muted-foreground">{activeIssue.environment}</p></div>}</Surface>
          </div>}
        </div>
      )}

      <Dialog open={duplicateModalOpen} onOpenChange={setDuplicateModalOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Mark as Duplicate</DialogTitle><DialogDescription>Link this issue to the original issue and resolve it.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="triage-duplicate-key">Original issue key</Label><Input id="triage-duplicate-key" placeholder={`${projectKey}-12`} value={targetDuplicateKey} onChange={(event) => setTargetDuplicateKey(event.target.value.toUpperCase())} /></div><DialogFooter><Button variant="outline" onClick={() => setDuplicateModalOpen(false)}>Cancel</Button><Button onClick={() => void handleConfirmDuplicate()} disabled={!canManage || loadingAction !== null}>Confirm duplicate</Button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}
