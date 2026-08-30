"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Flame,
  Milestone,
  ShieldAlert,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { ReleaseBriefPanel } from "@/components/intelligence/release-brief";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { normalizeReadinessAnalysis, readinessCsv, readinessRiskGroups, type ReadinessAnalysis, type ReadinessIssue } from "@/lib/readiness";
import { cn } from "@/lib/utils";
export type { ReadinessIssue } from "@/lib/readiness";

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
  initialAnalysis: ReadinessAnalysis;
  snapshots: ReadinessSnapshot[];
  milestones: MilestoneOption[];
  versions: VersionOption[];
  aiConfigured?: boolean;
};

export type ReadinessSnapshot = {
  id: string;
  milestoneId: string | null;
  versionId: string | null;
  score: number;
  status: string;
  breakdown: Record<string, unknown>;
  createdAt: string;
};

const NO_DATA_ANALYSIS: ReadinessAnalysis = {
  total: 0, resolvedCount: 0, openCount: 0, blockerCount: 0, criticalCount: 0,
  regressionCount: 0, unassignedCount: 0, unresolvedSecurityCount: 0,
  overdueMilestoneCount: 0, score: 0, status: "NO_DATA", issues: [],
};

export function ReadinessDashboard({
  projectName,
  projectKey,
  projectId,
  initialAnalysis,
  snapshots,
  milestones,
  versions,
  aiConfigured = true,
}: Props) {
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>("all");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("all");
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [history, setHistory] = useState(snapshots);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedMilestone = milestones.find((m) => m.id === selectedMilestoneId);
  const selectedVersion = versions.find((v) => v.id === selectedVersionId);
  const isUnfiltered = selectedMilestoneId === "all" && selectedVersionId === "all";
  const displayedAnalysis = isUnfiltered ? initialAnalysis : loading ? NO_DATA_ANALYSIS : analysis;
  const displayedLoading = !isUnfiltered && loading;
  const displayedError = isUnfiltered ? null : queryError;

  const risks = useMemo(() => readinessRiskGroups(displayedAnalysis), [displayedAnalysis]);
  const { blockers, criticals, regressions, unassigned, security, overdue, riskCount } = risks;

  useEffect(() => {
    if (selectedMilestoneId === "all" && selectedVersionId === "all") return;
    let active = true;
    async function loadAnalysis() {
      setLoading(true); setQueryError(null);
      try {
        const { data, error } = await createClient().rpc("calculate_release_readiness", {
          p_project_id: projectId,
          p_milestone_id: selectedMilestoneId === "all" ? undefined : selectedMilestoneId,
          p_version_id: selectedVersionId === "all" ? undefined : selectedVersionId,
        });
        if (!active) return;
        if (error) {
          setAnalysis(NO_DATA_ANALYSIS);
          setQueryError("Readiness could not be recalculated. Retry the selection.");
          return;
        }
        setAnalysis(normalizeReadinessAnalysis(data, projectKey));
      } catch {
        if (active) {
          setAnalysis(NO_DATA_ANALYSIS);
          setQueryError("Readiness could not be recalculated. Retry the selection.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadAnalysis();
    return () => { active = false; };
  }, [initialAnalysis, projectId, projectKey, selectedMilestoneId, selectedVersionId]);

  function exportCsv() {
    const blob = new Blob([readinessCsv(displayedAnalysis)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `${projectKey.toLowerCase()}-readiness.csv`; link.click(); URL.revokeObjectURL(url);
  }

  async function saveSnapshot() {
    setSaving(true); setQueryError(null);
    try {
      const client = createClient();
      const { data, error } = await client.rpc("save_release_readiness_snapshot", {
        p_project_id: projectId,
        p_milestone_id: selectedMilestoneId === "all" ? undefined : selectedMilestoneId,
        p_version_id: selectedVersionId === "all" ? undefined : selectedVersionId,
      });
      if (error || !data) { setQueryError("Snapshot could not be saved. Try again."); return; }
      const { data: rows, error: historyError } = await client.rpc("list_release_readiness_snapshots", {
        p_project_id: projectId,
        p_limit: 30,
      });
      if (!historyError && rows) {
        setHistory(rows.map((row) => ({ id: row.id, milestoneId: row.milestone_id, versionId: row.version_id, score: row.score, status: row.status, breakdown: (row.breakdown ?? {}) as Record<string, unknown>, createdAt: row.created_at })));
        toast.success("Readiness snapshot saved.");
      } else {
        setHistory((current) => [{ id: data, milestoneId: selectedMilestoneId === "all" ? null : selectedMilestoneId, versionId: selectedVersionId === "all" ? null : selectedVersionId, score: displayedAnalysis.score, status: displayedAnalysis.status, breakdown: { total: displayedAnalysis.total, score: displayedAnalysis.score, status: displayedAnalysis.status }, createdAt: new Date().toISOString() }, ...current]);
        setQueryError("Snapshot saved, but history could not be refreshed.");
      }
    } catch {
      setQueryError("Snapshot could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

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
            Backend-authoritative release evaluation for blockers, critical bugs, regressions, security, and overdue milestones in {projectName}.
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
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 font-mono text-xs" onClick={exportCsv} disabled={displayedLoading || displayedAnalysis.status === "NO_DATA"}>
            Export CSV
          </Button>
          <Button type="button" size="sm" className="h-8 font-mono text-xs" onClick={saveSnapshot} disabled={saving || displayedLoading || displayedAnalysis.status === "NO_DATA"}>
            {saving ? "Saving…" : "Save snapshot"}
          </Button>
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

      {displayedError && <div role="alert" className="mb-4 rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{displayedError}</div>}
      {displayedLoading && <div className="mb-4 rounded-[10px] border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Recalculating release readiness…</div>}
      <div className="mb-6">
        <ReleaseBriefPanel
          projectId={projectId}
          milestoneId={selectedMilestoneId === "all" ? null : selectedMilestoneId}
          versionId={selectedVersionId === "all" ? null : selectedVersionId}
          targetLabel={selectedMilestone ? `milestone ${selectedMilestone.name}` : selectedVersion ? `version ${selectedVersion.name}` : undefined}
          aiConfigured={aiConfigured}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Score & Rubric Panel */}
        <div className="space-y-4">
          <Surface className="p-6 text-center">
            <div className="inline-flex items-center justify-center rounded-full border border-border/80 p-4">
              <div
                className={cn(
                  "flex h-28 w-28 items-center justify-center rounded-full border-4 font-mono text-3xl font-bold tracking-tight shadow-lg",
                  displayedAnalysis.status === "NO_DATA"
                    ? "border-border bg-muted/30 text-muted-foreground"
                    : displayedAnalysis.status === "READY"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-emerald-500/10"
                    : displayedAnalysis.status === "ATTENTION"
                      ? "border-amber-500 bg-amber-500/10 text-amber-400 shadow-amber-500/10"
                      : "border-red-500 bg-red-500/10 text-red-400 shadow-red-500/10",
                )}
              >
                {displayedAnalysis.status === "NO_DATA" ? "—" : `${displayedAnalysis.score}%`}
              </div>
            </div>

            <div className="mt-4">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider",
                  displayedAnalysis.status === "NO_DATA"
                    ? "border-border bg-muted/30 text-muted-foreground"
                    : displayedAnalysis.status === "READY"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : displayedAnalysis.status === "ATTENTION"
                      ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                      : "border-red-500/40 bg-red-500/15 text-red-300",
                )}
              >
                {displayedAnalysis.status === "NO_DATA" ? (
                  <><AlertCircle className="h-3.5 w-3.5" /> No Release Data</>
                ) : displayedAnalysis.status === "READY" ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" /> Release Ready
                  </>
                ) : displayedAnalysis.status === "ATTENTION" ? (
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
                <span className="text-foreground">{displayedAnalysis.total > 0 ? `${displayedAnalysis.resolvedCount} / ${displayedAnalysis.total} (${Math.round((displayedAnalysis.resolvedCount / displayedAnalysis.total) * 100)}%)` : "No issue data"}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>Open blockers:</span>
                <span>{displayedAnalysis.blockerCount} (-{displayedAnalysis.blockerCount * 25} pts)</span>
              </div>
              <div className="flex justify-between text-amber-400">
                <span>Critical bugs:</span>
                <span>{displayedAnalysis.criticalCount} (-{displayedAnalysis.criticalCount * 10} pts)</span>
              </div>
              <div className="flex justify-between text-purple-400">
                <span>Regressions:</span>
                <span>{displayedAnalysis.regressionCount} (-{displayedAnalysis.regressionCount * 15} pts)</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Unassigned items:</span>
                <span>{displayedAnalysis.unassignedCount} (-{displayedAnalysis.unassignedCount * 5} pts)</span>
              </div>
              <div className="flex justify-between text-red-300">
                <span>Unresolved security:</span>
                <span>{displayedAnalysis.unresolvedSecurityCount} (-{displayedAnalysis.unresolvedSecurityCount * 10} pts)</span>
              </div>
              <div className="flex justify-between text-amber-300">
                <span>Overdue milestones:</span>
                <span>{displayedAnalysis.overdueMilestoneCount} (-{displayedAnalysis.overdueMilestoneCount * 5} pts)</span>
              </div>
            </div>
          </Surface>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Open Blockers</span>
              <p className="mt-1 font-mono text-xl font-bold text-red-400">{displayedAnalysis.blockerCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Critical Defects</span>
              <p className="mt-1 font-mono text-xl font-bold text-amber-400">{displayedAnalysis.criticalCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Regressions</span>
              <p className="mt-1 font-mono text-xl font-bold text-purple-400">{displayedAnalysis.regressionCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <span className="text-[11px] font-medium text-muted-foreground">Unassigned Work</span>
              <p className="mt-1 font-mono text-xl font-bold text-muted-foreground">{displayedAnalysis.unassignedCount}</p>
            </div>
          </div>
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
              <span className="font-mono text-xs text-muted-foreground">{riskCount} risks</span>
            </div>

            {displayedAnalysis.status === "NO_DATA" ? (
              <div className="py-12 text-center">
                <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">No release data</h3>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Add issues to this project or choose a different milestone/version to calculate readiness.</p>
              </div>
            ) : riskCount === 0 ? (
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
                {blockers.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-red-400">
                      <Flame className="h-3.5 w-3.5" /> Release Blockers (P0 / Blocker)
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-red-500/30 bg-red-500/5">
                      {blockers.map((issue) => (
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
                {criticals.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Critical Defects (P1 / Critical)
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-amber-500/30 bg-amber-500/5">
                      {criticals.map((issue) => (
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
                {regressions.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-purple-400">
                      <ShieldAlert className="h-3.5 w-3.5" /> Active Regressions
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-purple-500/30 bg-purple-500/5">
                      {regressions.map((issue) => (
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
                {unassigned.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-muted-foreground">
                      <UserX className="h-3.5 w-3.5" /> Unassigned Open Issues
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card/40">
                      {unassigned.map((issue) => (
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
                {security.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-red-300">
                      <ShieldAlert className="h-3.5 w-3.5" /> Unresolved Security Issues
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-red-500/30 bg-red-500/5">
                      {security.map((issue) => (
                        <li key={issue.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                          <div className="min-w-0 flex-1">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`} className="font-mono font-semibold text-primary hover:underline">{issue.keyLabel}</Link>
                            <span className="ml-2 truncate font-medium text-foreground">{issue.title}</span>
                          </div>
                          <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`}>Review <ExternalLink className="h-3 w-3" /></Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {overdue.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-amber-300">
                      <Milestone className="h-3.5 w-3.5" /> Issues in Overdue Milestones
                    </div>
                    <ul className="divide-y divide-border/60 rounded-lg border border-amber-500/30 bg-amber-500/5">
                      {overdue.map((issue) => (
                        <li key={issue.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                          <div className="min-w-0 flex-1">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`} className="font-mono font-semibold text-primary hover:underline">{issue.keyLabel}</Link>
                            <span className="ml-2 truncate font-medium text-foreground">{issue.title}</span>
                          </div>
                          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                            <Link href={`/dashboard/issues/${issue.keyLabel}`}>Review</Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Surface>
          <Surface className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between border-b border-border/80 pb-3">
              <div><h2 className="text-sm font-semibold">Readiness history</h2><p className="text-xs text-muted-foreground">Immutable snapshots of the backend score and factors.</p></div>
              <span className="font-mono text-xs text-muted-foreground">{history.length}</span>
            </div>
            {history.length === 0 ? <p className="py-4 text-xs text-muted-foreground">No snapshots saved yet.</p> : <div className="space-y-2">{history.slice(0, 8).map((snapshot) => <div key={snapshot.id} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs"><span className="font-mono">{snapshot.status}</span><span className="font-mono font-semibold">{snapshot.status === "NO_DATA" ? "—" : `${snapshot.score}%`}</span><time className="text-muted-foreground">{new Date(snapshot.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</time></div>)}</div>}
          </Surface>
        </div>
      </div>
    </main>
  );
}
