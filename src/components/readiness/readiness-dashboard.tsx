"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Flame,
  Milestone,
  Package,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserX,
  XCircle,
} from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { ReleaseBriefPanel } from "@/components/intelligence/release-brief";
import { categoryClasses, formatIssueKey } from "@/lib/issues";
import { cn } from "@/lib/utils";

export type ReadinessIssue = {
  id: string;
  issueNumber: number;
  keyLabel: string;
  title: string;
  type: string;
  priority: string;
  severity: string;
  statusCategory: string;
  statusName: string;
  assigneeId: string | null;
  assigneeLabel: string;
  componentName: string | null;
  targetMilestoneId: string | null;
  affectedVersionId: string | null;
};

export type MilestoneOption = {
  id: string;
  name: string;
  status: string;
  dueAt: string | null;
};

export type VersionOption = {
  id: string;
  name: string;
  isReleased: boolean;
};

type Props = {
  projectId: string;
  projectName: string;
  projectKey: string;
  issues: ReadinessIssue[];
  milestones: MilestoneOption[];
  versions: VersionOption[];
};

export function ReadinessDashboard({
  projectId,
  projectName,
  projectKey,
  issues,
  milestones,
  versions,
}: Props) {
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>("all");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("all");

  const targetIssues = useMemo(() => {
    return issues.filter((issue) =>
      (selectedMilestoneId === "all" || issue.targetMilestoneId === selectedMilestoneId) &&
      (selectedVersionId === "all" || issue.affectedVersionId === selectedVersionId),
    );
  }, [issues, selectedMilestoneId, selectedVersionId]);

  const selectedMilestone = milestones.find((m) => m.id === selectedMilestoneId);
  const selectedVersion = versions.find((v) => v.id === selectedVersionId);

  // Calculate explainable release score and risk list
  const analysis = useMemo(() => {
    const total = targetIssues.length;
    const resolved = targetIssues.filter(
      (i) => i.statusCategory === "RESOLVED" || i.statusCategory === "CLOSED",
    );
    const open = targetIssues.filter(
      (i) => i.statusCategory !== "RESOLVED" && i.statusCategory !== "CLOSED",
    );

    // Identify risk issues
    const blockers = open.filter((i) => i.priority === "P0" || i.severity === "BLOCKER");
    const criticals = open.filter((i) => (i.priority === "P1" || i.severity === "CRITICAL") && !blockers.includes(i));
    const regressions = open.filter((i) => i.type === "REGRESSION");
    const unassigned = open.filter((i) => !i.assigneeId);

    // Explainable score formula (0-100)
    // Baseline: completion % up to 100 points
    // Penalties:
    // - 25 points per blocker
    // - 10 points per critical
    // - 15 points per regression
    // - 5 points per unassigned
    let score = 100;
    if (total > 0) {
      const completionRatio = resolved.length / total;
      score = Math.round(completionRatio * 100);

      // Deduct penalties
      score -= blockers.length * 25;
      score -= criticals.length * 10;
      score -= regressions.length * 15;
      score -= unassigned.length * 5;

      // Bonus if all blockers resolved
      if (blockers.length === 0 && criticals.length === 0 && open.length === 0) {
        score = 100;
      }
    } else {
      score = 100;
    }
    score = Math.max(0, Math.min(100, score));

    let status: "READY" | "ATTENTION" | "BLOCKED" = "READY";
    if (score < 60 || blockers.length > 0) {
      status = "BLOCKED";
    } else if (score < 85 || criticals.length > 0 || regressions.length > 0) {
      status = "ATTENTION";
    } else {
      status = "READY";
    }

    const riskCount = new Set([...blockers, ...criticals, ...regressions, ...unassigned].map((issue) => issue.id)).size;
    return {
      total,
      resolvedCount: resolved.length,
      openCount: open.length,
      blockers,
      criticals,
      regressions,
      unassigned,
      riskCount,
      score,
      status,
    };
  }, [targetIssues]);

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {projectKey} · Release Gate
            </p>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Release Readiness Assessment</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Automated, explainable release evaluation checking blockers, critical bugs, regressions, and unassigned work for {projectName}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Milestone className="h-4 w-4 text-muted-foreground" />
          <select
            aria-label="Filter by milestone"
            value={selectedMilestoneId}
            onChange={(e) => setSelectedMilestoneId(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 font-mono text-xs"
          >
            <option value="all">All milestones</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.status}) {m.dueAt ? `· Due ${new Date(m.dueAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by version"
            value={selectedVersionId}
            onChange={(e) => setSelectedVersionId(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 font-mono text-xs"
          >
            <option value="all">All versions</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}{version.isReleased ? " (released)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Score & Rubric Panel */}
        <div className="space-y-4">
          <Surface className="p-6 text-center">
            <div className="inline-flex items-center justify-center rounded-full border border-border/80 p-4">
              <div
                className={cn(
                  "flex h-28 w-28 items-center justify-center rounded-full border-4 font-mono text-3xl font-bold tracking-tight shadow-lg",
                  analysis.status === "READY"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-emerald-500/10"
                    : analysis.status === "ATTENTION"
                      ? "border-amber-500 bg-amber-500/10 text-amber-400 shadow-amber-500/10"
                      : "border-red-500 bg-red-500/10 text-red-400 shadow-red-500/10",
                )}
              >
                {analysis.score}%
              </div>
            </div>

            <div className="mt-4">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider",
                  analysis.status === "READY"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : analysis.status === "ATTENTION"
                      ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                      : "border-red-500/40 bg-red-500/15 text-red-300",
                )}
              >
                {analysis.status === "READY" ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" /> Release Ready
                  </>
                ) : analysis.status === "ATTENTION" ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5" /> Needs Attention
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5" /> Release Blocked
                  </>
                )}
              </span>

              <p className="mt-2 text-xs text-muted-foreground">
                {selectedMilestone ? `Targeting milestone: ${selectedMilestone.name}` : selectedVersion ? `Targeting version: ${selectedVersion.name}` : "Evaluating overall project queue"}
              </p>
            </div>

            {/* Score rubric list */}
            <div className="mt-6 space-y-2 border-t border-border/70 pt-4 text-left font-mono text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Completed work:</span>
                <span className="text-foreground">{analysis.resolvedCount} / {analysis.total} ({analysis.total > 0 ? Math.round((analysis.resolvedCount / analysis.total) * 100) : 100}%)</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>Open blockers:</span>
                <span>{analysis.blockers.length} (-{analysis.blockers.length * 25} pts)</span>
              </div>
              <div className="flex justify-between text-amber-400">
                <span>Critical bugs:</span>
                <span>{analysis.criticals.length} (-{analysis.criticals.length * 10} pts)</span>
              </div>
              <div className="flex justify-between text-purple-400">
                <span>Regressions:</span>
                <span>{analysis.regressions.length} (-{analysis.regressions.length * 15} pts)</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Unassigned items:</span>
                <span>{analysis.unassigned.length} (-{analysis.unassigned.length * 5} pts)</span>
              </div>
            </div>
          </Surface>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Open Blockers</span>
              <p className="mt-1 font-mono text-xl font-bold text-red-400">{analysis.blockers.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Critical Defects</span>
              <p className="mt-1 font-mono text-xl font-bold text-amber-400">{analysis.criticals.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Regressions</span>
              <p className="mt-1 font-mono text-xl font-bold text-purple-400">{analysis.regressions.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Unassigned Work</span>
              <p className="mt-1 font-mono text-xl font-bold text-muted-foreground">{analysis.unassigned.length}</p>
            </div>
          </div>
          <ReleaseBriefPanel projectId={projectId} milestoneId={selectedMilestoneId === "all" ? null : selectedMilestoneId} versionId={selectedVersionId === "all" ? null : selectedVersionId} />
        </div>

        {/* Actionable Risk List */}
        <div className="space-y-4">
          <Surface className="p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-3">
              <div>
                <h2 className="text-sm font-semibold">Actionable Release Risks & Blockers</h2>
                <p className="text-xs text-muted-foreground">
                  Items that must be resolved or triaged before proceeding with release
                </p>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{analysis.riskCount} risks</span>
            </div>

            {analysis.blockers.length === 0 && analysis.criticals.length === 0 && analysis.regressions.length === 0 && analysis.unassigned.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">Zero Release Blockers</h3>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  All critical defects, blockers, and regressions are resolved. You are clear for release!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Blockers */}
                {analysis.blockers.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-red-400">
                      <Flame className="h-3.5 w-3.5" /> Release Blockers (P0 / Blocker)
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-red-500/30 bg-red-500/5">
                      {analysis.blockers.map((issue) => (
                        <li key={issue.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/dashboard/issues/${issue.keyLabel}`}
                                className="font-mono font-semibold text-primary hover:underline"
                              >
                                {issue.keyLabel}
                              </Link>
                              <span className="rounded bg-red-500/20 px-1.5 py-0.2 font-mono text-[9px] text-red-300 uppercase">
                                {issue.severity}
                              </span>
                              <span className="truncate font-medium text-foreground">{issue.title}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                              <span>Assignee: <strong className="text-foreground">{issue.assigneeLabel}</strong></span>
                              <span>Component: {issue.componentName || "—"}</span>
                            </div>
                          </div>

                          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`}>
                              Resolve <ExternalLink className="h-3 w-3" />
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Criticals */}
                {analysis.criticals.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Critical Defects (P1 / Critical)
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-amber-500/30 bg-amber-500/5">
                      {analysis.criticals.map((issue) => (
                        <li key={issue.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/dashboard/issues/${issue.keyLabel}`}
                                className="font-mono font-semibold text-primary hover:underline"
                              >
                                {issue.keyLabel}
                              </Link>
                              <span className="truncate font-medium text-foreground">{issue.title}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                              <span>Assignee: <strong className="text-foreground">{issue.assigneeLabel}</strong></span>
                              <span>Status: {issue.statusName}</span>
                            </div>
                          </div>

                          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`}>
                              Resolve <ExternalLink className="h-3 w-3" />
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Regressions */}
                {analysis.regressions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-purple-400">
                      <ShieldAlert className="h-3.5 w-3.5" /> Active Regressions
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-purple-500/30 bg-purple-500/5">
                      {analysis.regressions.map((issue) => (
                        <li key={issue.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/dashboard/issues/${issue.keyLabel}`}
                                className="font-mono font-semibold text-primary hover:underline"
                              >
                                {issue.keyLabel}
                              </Link>
                              <span className="truncate font-medium text-foreground">{issue.title}</span>
                            </div>
                          </div>
                          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`}>
                              Fix <ExternalLink className="h-3 w-3" />
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Unassigned */}
                {analysis.unassigned.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-muted-foreground">
                      <UserX className="h-3.5 w-3.5" /> Unassigned Open Issues
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card/40">
                      {analysis.unassigned.map((issue) => (
                        <li key={issue.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/dashboard/issues/${issue.keyLabel}`}
                                className="font-mono font-semibold text-primary hover:underline"
                              >
                                {issue.keyLabel}
                              </Link>
                              <span className="truncate text-muted-foreground">{issue.title}</span>
                            </div>
                          </div>
                          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`}>Assign</Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Surface>
        </div>
      </div>
    </main>
  );
}
