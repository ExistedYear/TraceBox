"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Layers,
  PieChart,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { categoryClasses } from "@/lib/issues";
import { cn } from "@/lib/utils";

export type ReportIssueItem = {
  id: string;
  issueNumber: number;
  title: string;
  type: string;
  priority: string;
  severity: string;
  statusCategory: string;
  statusName: string;
  componentName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
};

type Props = {
  projectName: string;
  projectKey: string;
  issues: ReportIssueItem[];
  components: Array<{ id: string; name: string }>;
};

type TimeRange = "7d" | "30d" | "90d" | "all";

export function ReportsDashboard({ projectName, projectKey, issues, components }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [now] = useState(() => Date.now());

  // Filter issues based on timeRange
  const filteredIssues = useMemo(() => {
    if (timeRange === "all") return issues;
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return issues.filter((i) => new Date(i.createdAt).getTime() >= cutoff);
  }, [issues, timeRange, now]);

  // Velocity & Resolution metrics
  const stats = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : timeRange === "90d" ? 90 : null;
    const cutoff = days ? now - days * 24 * 60 * 60 * 1000 : 0;

    const created = filteredIssues.length;

    const resolvedIssues = cutoff > 0
      ? issues.filter((i) => {
          const resTime = i.resolvedAt ? new Date(i.resolvedAt).getTime() : i.closedAt ? new Date(i.closedAt).getTime() : 0;
          return resTime >= cutoff;
        })
      : issues.filter((i) => Boolean(i.resolvedAt || i.closedAt || i.statusCategory === "RESOLVED" || i.statusCategory === "CLOSED"));
    const resolved = resolvedIssues.length;

    // Active backlog is a current-state metric, so it must include older open issues.
    const openIssues = issues.filter((i) => !i.resolvedAt && !i.closedAt && i.statusCategory !== "RESOLVED" && i.statusCategory !== "CLOSED");
    const open = openIssues.length;
    const total = filteredIssues.length;

    // MTTR calculation
    let totalResolutionHours = 0;
    for (const item of resolvedIssues) {
      if (item.resolvedAt || item.closedAt) {
        const start = new Date(item.createdAt).getTime();
        const end = new Date(item.resolvedAt || item.closedAt || item.createdAt).getTime();
        totalResolutionHours += Math.max(0, (end - start) / (1000 * 60 * 60));
      }
    }
    const avgResolutionDays = resolvedIssues.length > 0 ? (totalResolutionHours / resolvedIssues.length / 24).toFixed(1) : "—";
    let ageUnder7 = 0;
    let age7to30 = 0;
    let age30to90 = 0;
    let ageOver90 = 0;

    for (const item of openIssues) {
      const ageDays = (now - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < 7) ageUnder7++;
      else if (ageDays <= 30) age7to30++;
      else if (ageDays <= 90) age30to90++;
      else ageOver90++;
    }

    // Category counts
    const categoryCounts: Record<string, number> = {
      TRIAGE: 0,
      OPEN: 0,
      IN_PROGRESS: 0,
      REVIEW: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };
    for (const item of filteredIssues) {
      categoryCounts[item.statusCategory] = (categoryCounts[item.statusCategory] || 0) + 1;
    }

    // Priority counts
    const priorityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
    for (const item of filteredIssues) {
      if (item.priority in priorityCounts) priorityCounts[item.priority]++;
    }

    // Component breakdown
    const compCounts: Record<string, number> = {};
    for (const item of filteredIssues) {
      const cName = item.componentName || "Unassigned component";
      compCounts[cName] = (compCounts[cName] || 0) + 1;
    }

    return {
      total,
      created,
      resolved,
      open,
      avgResolutionDays,
      ageUnder7,
      age7to30,
      age30to90,
      ageOver90,
      categoryCounts,
      priorityCounts,
      compCounts,
    };
  }, [issues, timeRange, filteredIssues, now]);

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
              <BarChart3 className="h-3.5 w-3.5" />
            </span>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {projectKey} · Analytics
            </p>
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Engineering Reports & Velocity</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Created vs resolved metrics, MTTR velocity, issue aging distributions, and component health for {projectName}.
          </p>
        </div>

        {/* Time range selector buttons */}
        <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-card/60 p-1 text-xs">
          {(["7d", "30d", "90d", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={cn(
                "rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors",
                timeRange === range
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {range === "all" ? "All time" : `Last ${range.replace("d", " days")}`}
            </button>
          ))}
        </div>
      </div>

      {/* Top 4 KPI Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-muted-foreground">Created Issues</p>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-3 font-mono text-2xl font-semibold">{stats.created}</p>
          <p className="mt-1 text-xs text-muted-foreground">Filed within window</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-muted-foreground">Resolved Issues</p>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-3 font-mono text-2xl font-semibold">{stats.resolved}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.resolved} resolved in selected window
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-muted-foreground">Active Backlog</p>
            <AlertCircle className="h-4 w-4 text-blue-500" />
          </div>
          <p className="mt-3 font-mono text-2xl font-semibold">{stats.open}</p>
          <p className="mt-1 text-xs text-muted-foreground">Awaiting resolution</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-muted-foreground">Avg Resolution Time</p>
            <Clock className="h-4 w-4 text-purple-500" />
          </div>
          <p className="mt-3 font-mono text-2xl font-semibold">{stats.avgResolutionDays} <span className="text-xs font-normal text-muted-foreground">days</span></p>
          <p className="mt-1 text-xs text-muted-foreground">Mean turnaround (MTTR)</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Issue Age Breakdown */}
        <Surface className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-3">
            <div>
              <h2 className="text-sm font-semibold">Active Issue Age Distribution</h2>
              <p className="text-xs text-muted-foreground">Identifies aging and neglected bugs in active queue</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{stats.open} open</span>
          </div>

          <div className="space-y-3">
            {[
              { label: "< 7 days (Fresh)", count: stats.ageUnder7, color: "bg-emerald-500" },
              { label: "7 – 30 days (Normal)", count: stats.age7to30, color: "bg-blue-500" },
              { label: "30 – 90 days (Aging)", count: stats.age30to90, color: "bg-amber-500" },
              { label: "> 90 days (Stale)", count: stats.ageOver90, color: "bg-red-500" },
            ].map((age) => {
              const pct = stats.open > 0 ? (age.count / stats.open) * 100 : 0;
              return (
                <div key={age.label} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{age.label}</span>
                    <span className="font-mono text-muted-foreground">{age.count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full transition-all duration-300", age.color)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Surface>

        {/* State Category Distribution */}
        <Surface className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-3">
            <div>
              <h2 className="text-sm font-semibold">Lifecycle Status Breakdown</h2>
              <p className="text-xs text-muted-foreground">Distribution across standard workflow categories</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{stats.total} total</span>
          </div>

          <div className="space-y-3">
            {Object.entries(stats.categoryCounts).map(([cat, count]) => {
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className={cn("font-medium", categoryClasses(cat))}>{cat.replace("_", " ")}</span>
                    <span className="font-mono text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/70 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Surface>

        {/* Component Distribution */}
        <Surface className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-3">
            <div>
              <h2 className="text-sm font-semibold">Issues by Component</h2>
              <p className="text-xs text-muted-foreground">Bug density across architectural modules</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{Object.keys(stats.compCounts).length} components</span>
          </div>

          <div className="space-y-3">
            {Object.entries(stats.compCounts).map(([cName, count]) => {
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <div key={cName} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-foreground truncate max-w-xs">{cName}</span>
                    <span className="font-mono text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Surface>

        {/* Priority Breakdown */}
        <Surface className="p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between border-b border-border/80 pb-3">
            <div>
              <h2 className="text-sm font-semibold">Priority Distribution</h2>
              <p className="text-xs text-muted-foreground">Urgency distribution of filed work</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">P0 – P4</span>
          </div>

          <div className="space-y-3">
            {Object.entries(stats.priorityCounts).map(([priority, count]) => {
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <div key={priority} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className={cn("font-mono font-semibold", priority === "P0" ? "text-red-400" : priority === "P1" ? "text-amber-400" : "text-muted-foreground")}>
                      {priority} {priority === "P0" ? "(Blocker)" : priority === "P1" ? "(Critical)" : ""}
                    </span>
                    <span className="font-mono text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        priority === "P0" ? "bg-red-500" : priority === "P1" ? "bg-amber-500" : "bg-primary/60",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Surface>
      </div>
    </main>
  );
}
