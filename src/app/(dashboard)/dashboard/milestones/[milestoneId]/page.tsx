import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Milestone as MilestoneIcon,
  Ticket,
} from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { Button } from "@/components/ui/button";
import { categoryClasses, formatIssueKey, personLabel } from "@/lib/issues";
import { createClient } from "@/lib/supabase/server";
import { displayNameMap } from "@/lib/server-people";
import { cn } from "@/lib/utils";
import { getWorkspaceContext } from "@/lib/workspace-context";

type Params = Promise<{ milestoneId: string }>;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { milestoneId } = await params;
  if (!UUID_REGEX.test(milestoneId)) {
    return { title: "Milestone" };
  }
  const supabase = await createClient();
  const { data: milestone, error: milestoneError } = await supabase
    .from("milestones")
    .select("name")
    .eq("id", milestoneId)
    .maybeSingle();

  return { title: milestone ? `Milestone: ${milestone.name}` : "Milestone" };
}

export default async function MilestoneDetailPage({ params }: { params: Params }) {
  const { milestoneId } = await params;
  if (!UUID_REGEX.test(milestoneId)) {
    notFound();
  }
  const context = await getWorkspaceContext();
  const supabase = await createClient();
  const { data: milestone, error: milestoneError } = await supabase
    .from("milestones")
    .select("*, project:projects (id, key, name, organization_id)")
    .eq("id", milestoneId)
    .maybeSingle();

  if (milestoneError) {
    console.error("Milestone load failed", { code: milestoneError.code, message: milestoneError.message });
    return <LoadErrorPage title="Milestone unavailable" description="We could not load this milestone. Try again in a moment." retryHref={`/dashboard/milestones/${milestoneId}`} />;
  }

  if (!milestone || milestone.project?.organization_id !== context.activeOrganization.id) {
    notFound();
  }

  const { data: issues, error: issuesError } = await supabase
    .from("issues")
    .select("id, issue_number, title, type, priority, severity, assignee_id, updated_at, status:workflow_states (name, category)")
    .eq("target_milestone_id", milestoneId)
    .eq("project_id", milestone.project.id)
    .order("updated_at", { ascending: false });

  if (issuesError) {
    console.error("Milestone issues load failed", { code: issuesError.code, message: issuesError.message });
    return <LoadErrorPage title="Milestone issues unavailable" description="We could not load the complete issue list. No partial progress is being shown." retryHref={`/dashboard/milestones/${milestoneId}`} />;
  }

  const totalCount = issues?.length ?? 0;
  let resolvedCount = 0;
  let criticalCount = 0;

  for (const issue of issues ?? []) {
    const cat = issue.status?.category ?? "";
    if (cat === "RESOLVED" || cat === "CLOSED") {
      resolvedCount++;
    }
    if (issue.severity === "BLOCKER" || issue.severity === "CRITICAL") {
      criticalCount++;
    }
  }

  const openCount = totalCount - resolvedCount;
  const completionPercent = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  const assigneeIds = (issues ?? []).map((i) => i.assignee_id);
  const names = await displayNameMap(assigneeIds);

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      {/* Navigation Header */}
      <div className="mb-6">
        <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          <Link href="/dashboard/settings" className="hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> {milestone.project.key} · milestones
          </Link>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2.5">
              <MilestoneIcon className="h-6 w-6 text-primary" /> {milestone.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {milestone.description || `Milestone tracking for ${milestone.project.name}.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide",
                milestone.status === "ACTIVE"
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                  : milestone.status === "COMPLETED"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
              )}
            >
              {milestone.status}
            </span>
            {milestone.due_at && (
              <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" /> Due {new Date(milestone.due_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress & Metrics Cards */}
      <div className="space-y-6">
        <Surface className="p-5">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Progress</p>
              <p className="text-2xl font-bold tracking-tight font-mono">{completionPercent}%</p>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {resolvedCount} of {totalCount} issues completed
            </p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </Surface>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">Total Issues</p>
              <Ticket className="h-4 w-4 text-purple-500" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{totalCount}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">Open Issues</p>
              <AlertCircle className="h-4 w-4 text-amber-500" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{openCount}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">Resolved</p>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{resolvedCount}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">Critical & Blockers</p>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{criticalCount}</p>
          </div>
        </div>

        {/* Issues in Milestone */}
        <Surface>
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
            <h2 className="text-sm font-semibold">Issues in Milestone ({totalCount})</h2>
            <Button asChild size="sm" variant="outline" className="h-7 text-xs">
              <Link href="/dashboard/issues/new">Add issue</Link>
            </Button>
          </div>

          {totalCount === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No issues currently assigned to this milestone.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {(issues ?? []).map((issue) => {
                const keyLabel = formatIssueKey(milestone.project.key, issue.issue_number);
                return (
                  <li key={issue.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                    <Link
                      href={`/dashboard/issues/${keyLabel}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {keyLabel}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/issues/${keyLabel}`}
                        className="block truncate text-sm font-medium hover:text-primary"
                      >
                        {issue.title}
                      </Link>
                    </div>
                    <span
                      className={cn(
                        "whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        categoryClasses(issue.status?.category ?? ""),
                      )}
                    >
                      {issue.status?.name ?? "—"}
                    </span>
                    <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                      {issue.priority}
                    </span>
                    <span className="hidden text-xs text-muted-foreground md:inline">
                      {personLabel(names.get(issue.assignee_id ?? ""), issue.assignee_id)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Surface>
      </div>
    </main>
  );
}
