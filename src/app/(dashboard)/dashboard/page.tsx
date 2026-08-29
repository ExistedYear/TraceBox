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
  };
  let recentIssues: OverviewIssue[] = [];

  if (context.activeProject) {
    const projectId = context.activeProject.id;
    const projectKey = context.activeProject.key;

    const [
      { data: issueRows, error: issueError },
      { count: totalCount, error: totalError },
      { count: criticalCount, error: criticalError },
      { data: openStates, error: openStatesError },
      { data: inProgressStates, error: inProgressStatesError },
    ] = await Promise.all([
      supabase
        .from("issues")
        .select("id, issue_number, title, type, priority, severity, status_id, assignee_id, updated_at, status:workflow_states (name, category)")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(10),
      supabase
        .from("issues")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId),
      supabase
        .from("issues")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .in("severity", ["BLOCKER", "CRITICAL"]),
      supabase
        .from("workflow_states")
        .select("id")
        .eq("project_id", projectId)
        .in("category", ["TRIAGE", "OPEN"]),
      supabase
        .from("workflow_states")
        .select("id")
        .eq("project_id", projectId)
        .in("category", ["IN_PROGRESS", "REVIEW"]),
    ]);

    const firstError = issueError ?? totalError ?? criticalError ?? openStatesError ?? inProgressStatesError;
    if (firstError) {
      console.error("Dashboard metrics load failed", { code: firstError.code, message: firstError.message });
      return <LoadErrorPage title="Dashboard unavailable" description="We could not load the active project metrics. No partial totals are being shown." retryHref="/dashboard" />;
    }

    const openStateIds = (openStates ?? []).map((s) => s.id);
    const inProgressStateIds = (inProgressStates ?? []).map((s) => s.id);

    const openCountResult = openStateIds.length > 0
      ? await supabase.from("issues").select("id", { count: "exact", head: true }).eq("project_id", projectId).in("status_id", openStateIds)
      : { count: 0, error: null };
    const inProgressCountResult = inProgressStateIds.length > 0
      ? await supabase.from("issues").select("id", { count: "exact", head: true }).eq("project_id", projectId).in("status_id", inProgressStateIds)
      : { count: 0, error: null };
    const { count: openCount, error: openCountError } = openCountResult;
    const { count: inProgressCount, error: inProgressCountError } = inProgressCountResult;

    const stateCountError = openCountError ?? inProgressCountError;
    if (stateCountError) {
      console.error("Dashboard state metrics load failed", { code: stateCountError.code, message: stateCountError.message });
      return <LoadErrorPage title="Dashboard unavailable" description="We could not calculate the active project metrics. No partial totals are being shown." retryHref="/dashboard" />;
    }

    const assigneeIds = (issueRows ?? []).map((r) => r.assignee_id);
    const names = await displayNameMap(assigneeIds);

    metrics = {
      openCount: openCount ?? 0,
      inProgressCount: inProgressCount ?? 0,
      criticalCount: criticalCount ?? 0,
      totalCount: totalCount ?? 0,
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
      workspaceName={context.activeOrganization.name}
      organizationId={context.activeOrganization.id}
      activeProject={context.activeProject}
      projects={context.projects}
      metrics={metrics}
      recentIssues={recentIssues}
    />
  );
}
