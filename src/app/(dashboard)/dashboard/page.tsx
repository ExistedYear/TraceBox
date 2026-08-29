import type { Metadata } from "next";

import {
  DashboardOverview,
  type OverviewIssue,
  type OverviewMetrics,
} from "@/components/tracebox/dashboard-overview";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { formatIssueKey, personLabel } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Command Center" };

export default async function DashboardPage() {
  const context = await getWorkspaceContext();
  const supabase = await createClient();

  let metrics: OverviewMetrics = {
    openCount: 0,
    inProgressCount: 0,
    criticalCount: 0,
    totalCount: 0,
    assignedToMe: 0,
    awaitingTriage: 0,
    dueMilestones: 0,
  };
  let recentIssues: OverviewIssue[] = [];

  if (context.activeProject) {
    const projectId = context.activeProject.id;
    const projectKey = context.activeProject.key;

    const [
      { data: issueRows, error: issueError },
      { data: authoritativeMetrics, error: metricsError },
    ] = await Promise.all([
      supabase
        .from("issues")
        .select("id, issue_number, title, type, priority, severity, status_id, assignee_id, updated_at, status:workflow_states (name, category)")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(10),
      supabase.rpc("get_dashboard_metrics", { p_project_id: projectId }),
    ]);

    const firstError = issueError ?? metricsError;
    if (firstError) {
      console.error("Dashboard metrics load failed", { code: firstError.code, message: firstError.message });
      return <LoadErrorPage title="Dashboard unavailable" description="We could not load the active project metrics. No partial totals are being shown." retryHref="/dashboard" />;
    }

    if (!authoritativeMetrics?.[0]) {
      console.error("Dashboard authoritative metrics load failed", { code: metricsError?.code, message: metricsError?.message });
      return <LoadErrorPage title="Dashboard unavailable" description="We could not calculate the active project metrics. No partial totals are being shown." retryHref="/dashboard" />;
    }
    const m = authoritativeMetrics[0];

    const assigneeIds = (issueRows ?? []).map((r) => r.assignee_id);
    const names = await displayNameMap(assigneeIds);

    metrics = {
      openCount: Number(m.open_count ?? 0),
      inProgressCount: Number(m.in_progress_count ?? 0),
      criticalCount: Number(m.critical_count ?? 0),
      totalCount: Number(m.total_count ?? 0),
      assignedToMe: Number(m.assigned_to_me ?? 0),
      awaitingTriage: Number(m.awaiting_triage ?? 0),
      dueMilestones: Number(m.due_milestones ?? 0),
    };

    recentIssues = (issueRows ?? []).map((row) => ({
      id: row.id,
      issueNumber: row.issue_number,
      keyLabel: formatIssueKey(projectKey, row.issue_number),
      title: row.title,
      type: row.type,
      priority: row.priority,
      severity: row.severity,
      statusName: row.status?.name ?? "—",
      statusCategory: row.status?.category ?? "",
      assigneeLabel: personLabel(names.get(row.assignee_id ?? ""), row.assignee_id),
      updatedAt: row.updated_at,
    }));
  }

  return (
    <DashboardOverview
      userId={context.userId}
      workspaceName={context.activeOrganization.name}
      organizationId={context.activeOrganization.id}
      activeProject={context.activeProject}
      projects={context.projects}
      metrics={metrics}
      recentIssues={recentIssues}
      canCreateIssue={context.activeProjectRole === "REPORTER" || context.activeProjectRole === "DEVELOPER" || context.activeProjectRole === "MAINTAINER"}
      canCreateProject={context.activeOrganization.role === "OWNER" || context.activeOrganization.role === "ADMIN"}
    />
  );
}
