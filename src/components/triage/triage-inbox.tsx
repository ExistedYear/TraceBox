"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Inbox,
  Keyboard,
  Layers,
  Link2,
  Loader2,
  ShieldAlert,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { categoryClasses, formatIssueKey, personLabel } from "@/lib/issues";
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

type Props = {
  projectId: string;
  projectKey: string;
  issues: TriageIssue[];
  openStateId: string | null;
  closedStateId: string | null;
  workflowStates: StateOption[];
  members: MemberOption[];
  canManage: boolean;
};

export function TriageInbox({
  projectId,
  projectKey,
  issues: initialIssues,
  openStateId,
  closedStateId,
  workflowStates,
  members,
  canManage,
}: Props) {
  const router = useRouter();
  const [issues, setIssues] = useState<TriageIssue[]>(initialIssues);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Duplicate modal state
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [targetDuplicateKey, setTargetDuplicateKey] = useState("");
  const [duplicateCandidates, setDuplicateCandidates] = useState<
    Array<{ issue_id: string; issue_number: number; title: string; similarity: number }>
  >([]);
  const [findingDuplicates, setFindingDuplicates] = useState(false);

  const activeIssue = issues[selectedIndex] ?? null;

  // Load duplicate candidates whenever active issue changes
  useEffect(() => {
    if (!activeIssue) return;
    let isCurrent = true;
    void (async () => {
      try {
        const { data } = await createClient().rpc("find_duplicate_candidates", {
          p_project_id: projectId,
          p_title: activeIssue.title,
          p_limit: 4,
        });
        if (!isCurrent) return;
        const candidates = (data ?? []).filter((c) => c.issue_id !== activeIssue.id);
        setDuplicateCandidates(candidates);
      } catch {
        // Ignore lookup error
      } finally {
        if (isCurrent) setFindingDuplicates(false);
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [activeIssue, projectId]);

  // Remove handled issue from triage queue
  const removeActiveIssue = useCallback((id: string) => {
    setIssues((prev) => {
      const next = prev.filter((i) => i.id !== id);
      setSelectedIndex((curr) => (curr >= next.length ? Math.max(0, next.length - 1) : curr));
      return next;
    });
  }, []);

  // Action: Accept issue (transition to Open state)
  const handleAccept = useCallback(async () => {
    if (!activeIssue || !openStateId) {
      toast.error("No Open workflow state found for this project.");
      return;
    }
    setLoadingAction("accept");
    try {
      const { error } = await createClient().rpc("transition_issue", {
        p_issue_id: activeIssue.id,
        p_to_state_id: openStateId,
      });
      if (error) {
        toast.error("Could not accept issue: " + error.message);
        return;
      }
      toast.success(`${activeIssue.keyLabel} accepted into Open queue.`);
      removeActiveIssue(activeIssue.id);
      router.refresh();
    } catch {
      toast.error("Could not reach server.");
    } finally {
      setLoadingAction(null);
    }
  }, [activeIssue, openStateId, removeActiveIssue, router]);

  // Action: Reject issue (transition to Closed as WONT_FIX)
  const handleReject = useCallback(async () => {
    if (!activeIssue || !closedStateId) {
      toast.error("No Closed workflow state found.");
      return;
    }
    setLoadingAction("reject");
    try {
      const { error } = await createClient().rpc("transition_issue", {
        p_issue_id: activeIssue.id,
        p_to_state_id: closedStateId,
        p_resolution: "WONT_FIX",
      });
      if (error) {
        toast.error("Could not reject issue: " + error.message);
        return;
      }
      toast.success(`${activeIssue.keyLabel} rejected as Won't Fix.`);
      removeActiveIssue(activeIssue.id);
      router.refresh();
    } catch {
      toast.error("Could not reach server.");
    } finally {
      setLoadingAction(null);
    }
  }, [activeIssue, closedStateId, removeActiveIssue, router]);

  // Action: Mark as Duplicate
  const handleConfirmDuplicate = async (duplicateTargetKey?: string) => {
    const keyToUse = duplicateTargetKey || targetDuplicateKey.trim();
    if (!activeIssue || !keyToUse || !closedStateId) {
      toast.error("Please enter or select the original issue key.");
      return;
    }
    setLoadingAction("duplicate");
    try {
      const supabase = createClient();
      // Look up target issue
      const numMatch = /^([A-Za-z]+-)?(\d+)$/.exec(keyToUse);
      if (!numMatch) {
        toast.error("Invalid issue key format (e.g. CORE-12).");
        setLoadingAction(null);
        return;
      }
      const num = parseInt(numMatch[2], 10);
      const { data: targetIssue, error: lookupErr } = await supabase
        .from("issues")
        .select("id")
        .eq("project_id", projectId)
        .eq("issue_number", num)
        .maybeSingle();

      if (lookupErr || !targetIssue) {
        toast.error(`Target issue ${keyToUse} not found in this project.`);
        setLoadingAction(null);
        return;
      }

      // Add DUPLICATE_OF link
      await supabase.rpc("add_issue_link", {
        p_source_issue_id: activeIssue.id,
        p_target_issue_id: targetIssue.id,
        p_relationship: "DUPLICATE_OF",
      });

      // Transition to Closed / DUPLICATE
      const { error } = await supabase.rpc("transition_issue", {
        p_issue_id: activeIssue.id,
        p_to_state_id: closedStateId,
        p_resolution: "DUPLICATE",
      });

      if (error) {
        toast.error("Could not resolve as duplicate: " + error.message);
        return;
      }

      toast.success(`${activeIssue.keyLabel} marked as duplicate of ${keyToUse}.`);
      setDuplicateModalOpen(false);
      setTargetDuplicateKey("");
      removeActiveIssue(activeIssue.id);
      router.refresh();
    } catch {
      toast.error("Could not reach server.");
    } finally {
      setLoadingAction(null);
    }
  };

  // Action: Assign to user
  const handleAssign = async (assigneeId: string) => {
    if (!activeIssue) return;
    try {
      const { error } = await createClient().rpc("assign_issue", {
        p_issue_id: activeIssue.id,
        p_assignee_id: assigneeId || null,
      });
      if (error) {
        toast.error("Could not assign issue.");
        return;
      }
      const member = members.find((m) => m.userId === assigneeId);
      setIssues((prev) =>
        prev.map((item) =>
          item.id === activeIssue.id
            ? { ...item, assigneeId: assigneeId || null, assigneeLabel: personLabel(member?.displayName, assigneeId) }
            : item,
        ),
      );
      toast.success(`Assigned to ${member?.displayName || "engineer"}.`);
    } catch {
      toast.error("Could not reach server.");
    }
  };

  // Keyboard navigation & shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when typing inside an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1 < issues.length ? i + 1 : i));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i > 0 ? i - 1 : 0));
      } else if (e.key === "a" && !duplicateModalOpen) {
        e.preventDefault();
        void handleAccept();
      } else if (e.key === "r" && !duplicateModalOpen) {
        e.preventDefault();
        void handleReject();
      } else if (e.key === "d" && !duplicateModalOpen) {
        e.preventDefault();
        setDuplicateModalOpen(true);
      } else if (e.key === "o" && activeIssue) {
        e.preventDefault();
        router.push(`/dashboard/issues/${activeIssue.keyLabel}`);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [issues.length, activeIssue, duplicateModalOpen, handleAccept, handleReject, router]);

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-amber-500/10 text-amber-400">
              <Inbox className="h-3.5 w-3.5" />
            </span>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {projectKey} · Triage Inbox
            </p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Triage & Classification</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Review incoming bugs, verify validity, detect duplicates, and accept or reject items with rapid keyboard controls.
          </p>
        </div>

        {/* Keyboard hints badge */}
        <div className="hidden items-center gap-3 rounded-lg border border-border/70 bg-card/40 px-3 py-1.5 font-mono text-[11px] text-muted-foreground sm:flex">
          <Keyboard className="h-3.5 w-3.5 text-primary" />
          <span><strong className="text-foreground">J/K</strong> navigate</span>
          <span><strong className="text-foreground">A</strong> accept</span>
          <span><strong className="text-foreground">R</strong> reject</span>
          <span><strong className="text-foreground">D</strong> duplicate</span>
          <span><strong className="text-foreground">O</strong> open</span>
        </div>
      </div>

      {issues.length === 0 ? (
        <Surface className="p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <h2 className="text-base font-semibold">Triage inbox is clean</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            All newly reported bugs and tasks in {projectKey} have been triaged and accepted into active engineering workflows.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href="/dashboard/issues">Browse active issues</Link>
            </Button>
            <Button asChild size="sm" className="h-8 text-xs">
              <Link href="/dashboard/issues/new">Report new issue</Link>
            </Button>
          </div>
        </Surface>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* Left list pane */}
          <Surface className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/80 px-3.5 py-2.5">
              <span className="font-mono text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Unreviewed Queue ({issues.length})
              </span>
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                {selectedIndex + 1} of {issues.length}
              </span>
            </div>

            <div className="max-h-[calc(100vh-280px)] divide-y divide-border/60 overflow-y-auto">
              {issues.map((issue, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    className={cn(
                      "flex w-full flex-col gap-1 p-3 text-left transition-colors",
                      isSelected
                        ? "bg-primary/10 border-l-2 border-primary"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">{issue.keyLabel}</span>
                      <span className={cn("rounded-full border px-1.5 py-0.2 font-mono text-[9px] uppercase", categoryClasses(issue.statusCategory))}>
                        {issue.severity}
                      </span>
                    </div>
                    <p className="truncate text-xs font-medium text-foreground">{issue.title}</p>
                    <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground/70">
                      <span>{issue.type} · {issue.componentName || "No component"}</span>
                      <span>{new Date(issue.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Surface>

          {/* Right detail & action pane */}
          {activeIssue && (
            <div className="space-y-4">
              {/* Triage Action Toolbar */}
              <Surface className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void handleAccept()}
                      disabled={loadingAction !== null}
                      className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                    >
                      {loadingAction === "accept" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Accept Issue (A)
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDuplicateModalOpen(true)}
                      disabled={loadingAction !== null}
                      className="h-8 gap-1.5 text-xs text-amber-400 hover:text-amber-300"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Mark Duplicate (D)
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleReject()}
                      disabled={loadingAction !== null}
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                    >
                      {loadingAction === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                      Reject / Won&apos;t Fix (R)
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Quick Assign Lead */}
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={activeIssue.assigneeId ?? ""}
                      onChange={(e) => void handleAssign(e.target.value)}
                    >
                      <option value="">Assign engineer...</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName ?? m.userId.slice(0, 8)}
                        </option>
                      ))}
                    </select>

                    <Button asChild size="sm" variant="outline" className="h-8 gap-1 text-xs">
                      <Link href={`/dashboard/issues/${activeIssue.keyLabel}`} target="_blank">
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Surface>

              {/* Duplicate Candidates Card */}
              {findingDuplicates ? (
                <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Scanning for similar reported bugs...
                </div>
              ) : duplicateCandidates.length > 0 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Possible duplicate issues detected:
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {duplicateCandidates.map((cand) => (
                      <div
                        key={cand.issue_id}
                        className="flex items-center justify-between gap-2 rounded border border-amber-500/20 bg-background/80 p-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-mono font-semibold text-primary">{formatIssueKey(projectKey, cand.issue_number)}</span>
                          <p className="truncate text-muted-foreground">{cand.title}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => void handleConfirmDuplicate(formatIssueKey(projectKey, cand.issue_number))}
                        >
                          Duplicate
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Issue Detail Content */}
              <Surface className="p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3">
                  <div>
                    <span className="font-mono text-xs font-semibold text-primary">{activeIssue.keyLabel}</span>
                    <h2 className="text-lg font-semibold tracking-tight">{activeIssue.title}</h2>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="rounded bg-muted px-2 py-0.5">{activeIssue.type}</span>
                    <span className="rounded bg-muted px-2 py-0.5">{activeIssue.priority}</span>
                    <span className="rounded bg-muted px-2 py-0.5">{activeIssue.severity}</span>
                  </div>
                </div>

                {/* Facts row */}
                <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-border/70 bg-card/40 p-3 text-xs sm:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">Component:</span>
                    <p className="font-medium">{activeIssue.componentName || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reporter:</span>
                    <p className="font-medium">{activeIssue.reporterLabel}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Assignee:</span>
                    <p className="font-medium">{activeIssue.assigneeLabel}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reported:</span>
                    <p className="font-medium">{new Date(activeIssue.createdAt).toLocaleString()}</p>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-3 text-sm">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3>
                    <p className="mt-1 whitespace-pre-wrap rounded border border-border/60 bg-background/50 p-3 text-xs leading-relaxed">
                      {activeIssue.description || "No description provided."}
                    </p>
                  </div>

                  {activeIssue.environment && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Environment</h3>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{activeIssue.environment}</p>
                    </div>
                  )}

                  {activeIssue.stepsToReproduce && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Steps to Reproduce</h3>
                      <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{activeIssue.stepsToReproduce}</p>
                    </div>
                  )}
                </div>
              </Surface>
            </div>
          )}
        </div>
      )}

      {/* Duplicate Dialog */}
      <Dialog open={duplicateModalOpen} onOpenChange={setDuplicateModalOpen}>
        <DialogContent className="max-w-md rounded-[10px]">
          <DialogHeader>
            <DialogTitle className="text-base">Mark as Duplicate</DialogTitle>
            <DialogDescription>
              Link this issue as a duplicate of another existing issue and resolve it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="triage-dup-key">Original Issue Key</Label>
              <Input
                id="triage-dup-key"
                placeholder="e.g. CORE-12"
                value={targetDuplicateKey}
                onChange={(e) => setTargetDuplicateKey(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleConfirmDuplicate()}
              disabled={!targetDuplicateKey.trim() || loadingAction !== null}
            >
              {loadingAction === "duplicate" && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
