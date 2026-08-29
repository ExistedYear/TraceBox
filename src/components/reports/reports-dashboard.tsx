"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, BarChart3, CheckCircle2, Clock, Download, RefreshCw, TrendingUp } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { normalizeReportMetrics, reportMetricsCsv, type ReportIssue, type ReportMetrics } from "@/lib/reports";
import { cn } from "@/lib/utils";

type TimeRange = "7d" | "30d" | "90d" | "365d" | "all";
const ranges: Array<{ value: TimeRange; days: number }> = [{ value: "7d", days: 7 }, { value: "30d", days: 30 }, { value: "90d", days: 90 }, { value: "365d", days: 365 }, { value: "all", days: 0 }];
type DrilldownMetric = "created" | "resolved" | "backlog";

type Props = {
  projectId: string;
  projectName: string;
  projectKey: string;
  initialMetrics: Record<string, unknown>;
  components?: Array<{ id: string; name: string }>;
};

function countRows(rows: Array<{ name: string; count: number }>) {
  return rows.length ? rows : [{ name: "No data", count: 0 }];
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
  const values = countRows(rows);
  const max = Math.max(1, ...values.map((row) => row.count));
  return <Surface className="p-4"><h2 className="mb-3 text-sm font-semibold">{title}</h2><div className="space-y-3">{values.map((row) => <div key={row.name} className="space-y-1"><div className="flex justify-between gap-3 text-xs"><span className="truncate">{row.name}</span><span className="font-mono text-muted-foreground">{row.count}</span></div><div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(row.count / max) * 100}%` }} /></div></div>)}</div></Surface>;
}

function IssueList({ projectKey, issues }: { projectKey: string; issues: ReportIssue[] }) {
  if (!issues.length) return <p className="p-6 text-center text-xs text-muted-foreground">No issues match this metric in the selected window.</p>;
  return <div className="divide-y divide-border/60">{issues.map((issue) => <Link key={issue.id} href={`/dashboard/issues/${projectKey}-${issue.issue_number}`} className="block px-4 py-3 transition-colors hover:bg-muted/40"><div className="flex items-start justify-between gap-3"><span className="font-mono text-[11px] text-primary">{projectKey}-{issue.issue_number}</span><span className="text-[11px] text-muted-foreground">{issue.status_name ?? issue.status ?? ""}</span></div><p className="mt-1 truncate text-xs font-medium">{issue.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{[issue.type, issue.priority, issue.component_name].filter(Boolean).join(" · ")}</p></Link>)}</div>;
}

export function ReportsDashboard({ projectName, projectKey, projectId, initialMetrics }: Props) {
  const initial = useMemo(() => normalizeReportMetrics(initialMetrics), [initialMetrics]);
  const [timeRange, setTimeRange] = useState<TimeRange>(ranges.find((range) => range.days === initial.window_days)?.value ?? "30d");
  const [drilldownMetric, setDrilldownMetric] = useState<DrilldownMetric>("backlog");
  const [metrics, setMetrics] = useState<ReportMetrics>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const days = ranges.find((range) => range.value === timeRange)?.days ?? 30;
    if (days === initial.window_days && retryNonce === 0) return;
    let active = true;
    void createClient().rpc("get_issue_reports", { p_project_id: projectId, p_window_days: days }).then(({ data, error: rpcError }) => {
      if (!active) return;
      if (rpcError || !data) setError(true); else setMetrics(normalizeReportMetrics(data));
      setLoading(false);
    });
    return () => { active = false; };
  }, [initial, initial.window_days, projectId, retryNonce, timeRange]);

  const buckets = Object.entries(metrics.category_counts).map(([name, count]) => ({ name: name.replaceAll("_", " "), count }));
  const priorities = Object.entries(metrics.priority_counts).map(([name, count]) => ({ name, count }));
  const drilldown = metrics.drilldowns[drilldownMetric].length || drilldownMetric !== "backlog" ? metrics.drilldowns[drilldownMetric] : metrics.drilldown;
  const csv = () => { const blob = new Blob([reportMetricsCsv(projectKey, metrics)], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${projectKey.toLowerCase()}-reports-${timeRange}.csv`; anchor.click(); URL.revokeObjectURL(url); };

  return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-5"><div><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary"><BarChart3 className="h-3.5 w-3.5" /></span><p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">{projectKey} · Analytics</p></div><h1 className="mt-1 text-2xl font-semibold tracking-tight">Engineering reports</h1><p className="mt-1 text-xs text-muted-foreground">Authoritative created, resolved, backlog, and resolution trends for {projectName}.</p></div><div className="flex items-center gap-2"><div className="flex items-center gap-1 rounded-lg border border-border/80 bg-card/60 p-1">{ranges.map((range) => <button key={range.value} type="button" onClick={() => { if (range.value === timeRange) return; setLoading(true); setError(false); setTimeRange(range.value); }} aria-pressed={timeRange === range.value} className={cn("rounded px-2.5 py-1 font-mono text-[11px]", timeRange === range.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{range.value === "all" ? "All time" : `Last ${range.days} days`}</button>)}</div><Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={csv} disabled={metrics.no_data}><Download className="h-3 w-3" />CSV</Button></div></div>
    {loading ? <Surface className="mb-4 flex items-center gap-2 p-3 text-xs text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Loading the selected window…</Surface> : null}
    {error ? <div className="mb-4" role="alert"><Surface className="flex items-center justify-between gap-3 p-4 text-xs text-muted-foreground"><span>Reports could not be loaded for this window. No partial metrics are shown.</span><Button size="sm" variant="outline" onClick={() => { setLoading(true); setError(false); setRetryNonce((value) => value + 1); }}>Retry</Button></Surface></div> : null}
    {!error && metrics.no_data ? <Surface className="p-12 text-center"><BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 text-base font-semibold">No report data</h2><p className="mt-1 text-xs text-muted-foreground">There are no issues visible to you in this project yet.</p></Surface> : null}
    {!error && !metrics.no_data ? <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Kpi label="Created issues" value={metrics.created} hint="Filed in selected window" icon={<TrendingUp className="h-4 w-4 text-primary" />} /><Kpi label="Resolved issues" value={metrics.resolved} hint="Resolved in selected window" icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} /><Kpi label="Active backlog" value={metrics.backlog} hint="Current visible open work" icon={<AlertCircle className="h-4 w-4 text-blue-500" />} /><Kpi label="Mean resolution" value={metrics.resolution_duration.avg_days == null ? "—" : `${metrics.resolution_duration.avg_days}d`} hint={`${metrics.resolution_duration.count} resolved issues`} icon={<Clock className="h-4 w-4 text-purple-500" />} /></div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2"><Breakdown title="Lifecycle status" rows={buckets} /><Breakdown title="Priority distribution" rows={priorities} /><Breakdown title="Issues by assignee" rows={metrics.by_assignee.map((row) => ({ name: row.name, count: row.count }))} /><Breakdown title="Issues by milestone" rows={metrics.by_milestone.map((row) => ({ name: row.name, count: row.count }))} /></div>
      <Surface className="mt-5 p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Historical trend</h2><p className="text-xs text-muted-foreground">Daily created, resolved, and point-in-time backlog</p></div><span className="font-mono text-[11px] text-muted-foreground">{metrics.historical_trend.length} days</span></div><div className="space-y-2">{metrics.historical_trend.slice(-30).map((point) => <div key={point.day} role="group" aria-label={`${point.day}: ${point.created} created, ${point.resolved} resolved, ${point.backlog} backlog`} className="grid grid-cols-[70px_1fr_1fr_1fr] items-center gap-2 text-[11px]"><span className="font-mono text-muted-foreground">{point.day}</span><span aria-hidden="true" className="h-2 rounded bg-primary/70" style={{ width: `${Math.min(100, point.created * 12 + (point.created ? 4 : 0))}%` }} title={`Created ${point.created}`} /><span aria-hidden="true" className="h-2 rounded bg-emerald-500/70" style={{ width: `${Math.min(100, point.resolved * 12 + (point.resolved ? 4 : 0))}%` }} title={`Resolved ${point.resolved}`} /><span aria-hidden="true" className="h-2 rounded bg-amber-500/70" style={{ width: `${Math.min(100, point.backlog * 4 + (point.backlog ? 4 : 0))}%` }} title={`Backlog ${point.backlog}`} /><span className="sr-only">{point.created} created, {point.resolved} resolved, {point.backlog} backlog</span></div>)}</div><div className="mt-3 flex gap-4 text-[11px] text-muted-foreground"><span>Created</span><span>Resolved</span><span>Backlog</span></div></Surface>
      <Surface className="mt-5"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4"><div><h2 className="text-sm font-semibold">Issue drilldown</h2><p className="text-xs text-muted-foreground">Up to 200 authorized issues, linked to detail</p></div><span className="font-mono text-[11px] text-muted-foreground">{drilldown.length} shown</span></div><div className="flex gap-1 border-b border-border/60 px-4 pt-3" role="tablist" aria-label="Report issue drilldowns">{(["created", "resolved", "backlog"] as const).map((metric) => <button key={metric} type="button" role="tab" aria-selected={drilldownMetric === metric} onClick={() => setDrilldownMetric(metric)} className={cn("rounded-t px-3 py-2 font-mono text-[11px] uppercase tracking-wide", drilldownMetric === metric ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}>{metric} <span className="ml-1">{metrics.drilldowns[metric].length}</span></button>)}</div><IssueList projectKey={projectKey} issues={drilldown} /></Surface>
    </> : null}
  </main>;
}

function Kpi({ label, value, hint, icon }: { label: string; value: number | string; hint: string; icon: React.ReactNode }) { return <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-start justify-between"><p className="text-xs font-medium text-muted-foreground">{label}</p>{icon}</div><p className="mt-3 font-mono text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>; }
