"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CircleDot,
  FolderKanban,
  Plus,
  Ticket,
} from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { categoryClasses } from "@/lib/issues";
import { cn } from "@/lib/utils";
import { NewProjectButton, selectProject, type ProjectSummary } from "@/components/layout/workspace-switcher";

export type OverviewIssue = {
  id: string;
  issueNumber: number;
  keyLabel: string;
  title: string;
  type: string;
  priority: string;
  severity: string;
  statusName: string;
  statusCategory: string;
  assigneeLabel: string;
  updatedAt: string;
};

export type OverviewMetrics = {
  openCount: number;
  inProgressCount: number;
  criticalCount: number;
  totalCount: number;
  assignedToMe: number;
  awaitingTriage: number;
  dueMilestones: number;
};

type DashboardOverviewProps = {
  userId: string;
  workspaceName: string;
  organizationId: string;
  activeProject: ProjectSummary | null;
  projects: ProjectSummary[];
  metrics: OverviewMetrics;
  recentIssues: OverviewIssue[];
};

function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function DashboardOverview({
  workspaceName,
  userId,
  organizationId,
  activeProject,
  projects,
  metrics,
  recentIssues,
}: DashboardOverviewProps) {
  const router = useRouter();
  function selectProjectAndOpen(projectId: string) {
    selectProject(projectId);
    router.push("/dashboard/issues");
  }
  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      {/* Header / Command Center banner */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Command Center · {workspaceName}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Engineering Status
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeProject
              ? `Active issue queue and metrics for ${activeProject.name} (${activeProject.key}).`
              : `Select a project below to load its issue metrics and recent activity.`}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {activeProject ? (
            <>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <Link href="/dashboard/issues">
                  <CircleDot className="h-3.5 w-3.5" /> View issue queue
                </Link>
              </Button>
              <Button asChild size="sm" className="h-8 gap-1.5 text-xs">
                <Link href="/dashboard/issues/new">
                  <Plus className="h-3.5 w-3.5" /> New issue
                </Link>
              </Button>
            </>
          ) : (
            <NewProjectButton organizationId={organizationId} />
          )}
        </div>
      </div>

      {projects.length === 0 ? (
        <Surface className="p-12 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <FolderKanban className="h-6 w-6" />
          </span>
          <h2 className="text-base font-semibold">No projects yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Create your first project in {workspaceName} to start tracking issues, components, and workflows.
          </p>
          <div className="mt-5 flex justify-center">
            <NewProjectButton organizationId={organizationId} />
          </div>
        </Surface>
      ) : (
        <div className="space-y-8">
          {!activeProject ? <Surface className="p-8 text-center"><FolderKanban className="mx-auto h-8 w-8 text-primary" /><h2 className="mt-3 text-sm font-semibold">Choose an active project</h2><p className="mt-1 text-xs text-muted-foreground">Metrics are project-specific. Select a project from the list below to open its issue queue.</p></Surface> : <>
          {/* Metrics Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link href={`/dashboard/issues?assignee=${encodeURIComponent(userId)}&unresolved=1`} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"><p className="text-xs font-medium text-muted-foreground">Assigned to me</p><p className="mt-3 font-mono text-2xl font-semibold">{metrics.assignedToMe}</p><p className="mt-1 text-xs text-muted-foreground">Your active work</p></Link>
            <Link href="/dashboard/issues?status_category=TRIAGE" className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"><p className="text-xs font-medium text-muted-foreground">Awaiting triage</p><p className="mt-3 font-mono text-2xl font-semibold">{metrics.awaitingTriage}</p><p className="mt-1 text-xs text-muted-foreground">Unreviewed issues</p></Link>
            <Link href="/dashboard/issues?overdue=1&unresolved=1" className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"><p className="text-xs font-medium text-muted-foreground">Due milestones</p><p className="mt-3 font-mono text-2xl font-semibold">{metrics.dueMilestones}</p><p className="mt-1 text-xs text-muted-foreground">Overdue milestone work</p></Link>
            <Link href="/dashboard/issues?status_category=TRIAGE,OPEN" className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground">Open & Triage</p>
                <AlertCircle className="h-4 w-4 text-amber-500" />
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold tracking-tight">{metrics.openCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Awaiting resolution or triage</p>
            </Link>

            <Link href="/dashboard/issues?status_category=IN_PROGRESS,REVIEW" className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground">In Progress & Review</p>
                <Activity className="h-4 w-4 text-blue-500" />
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold tracking-tight">{metrics.inProgressCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Under active engineering</p>
            </Link>

            <Link href="/dashboard/issues?critical=1&unresolved=1" className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground">Critical & Blockers</p>
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold tracking-tight">{metrics.criticalCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Highest severity issues</p>
            </Link>

            <Link href="/dashboard/issues" className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium text-muted-foreground">Total Issues</p>
                <Ticket className="h-4 w-4 text-purple-500" />
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold tracking-tight">{metrics.totalCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">Tracked in active project</p>
            </Link>
          </div>

          {/* Recent Issues Section */}
          <Surface>
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Recent Issues</h2>
                <p className="text-xs text-muted-foreground">Latest filed or updated items in the queue</p>
              </div>
              {activeProject && (
                <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground">
                  <Link href="/dashboard/issues">
                    View all <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>

            {recentIssues.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No issues filed yet in this project.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {recentIssues.map((issue) => (
                  <li key={issue.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                    <Link
                      href={`/dashboard/issues/${issue.keyLabel}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {issue.keyLabel}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/issues/${issue.keyLabel}`}
                        className="block truncate text-sm font-medium hover:text-primary"
                      >
                        {issue.title}
                      </Link>
                    </div>
                    <span
                      className={cn(
                        "whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        categoryClasses(issue.statusCategory),
                      )}
                    >
                      {issue.statusName}
                    </span>
                    <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                      {issue.priority}
                    </span>
                    <span className="hidden text-xs text-muted-foreground md:inline">
                      {issue.assigneeLabel}
                    </span>
                    <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground/70">
                      {relativeTime(issue.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
          </>}

          {/* Projects Summary Section */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Projects in {workspaceName} ({projects.length})
              </h2>
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                <Link href="/dashboard/projects">Manage projects</Link>
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => selectProjectAndOpen(project.id)}
                  className={cn(
                    "block w-full rounded-xl border p-4 text-left transition-colors hover:border-primary/40",
                    activeProject?.id === project.id ? "border-primary/50 bg-primary/5" : "border-border bg-card",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-primary">{project.key}</span>
                    {activeProject?.id === project.id && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">
                        active
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-semibold">{project.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
