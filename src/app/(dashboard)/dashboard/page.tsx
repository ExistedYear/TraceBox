import type { Metadata } from "next";

import {
  DashboardOverview,
  type OverviewIssue,
  type OverviewMetrics,
} from "@/components/tracebox/dashboard-overview";
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
      { data: issueRows },
      { count: totalCount },
      { count: criticalCount },
      { data: openStates },
      { data: inProgressStates },
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

    const openStateIds = (openStates ?? []).map((s) => s.id);
    const inProgressStateIds = (inProgressStates ?? []).map((s) => s.id);

    const [{ count: openCount }, { count: inProgressCount }] = await Promise.all([
      openStateIds.length > 0
        ? supabase.from("issues").select("id", { count: "exact", head: true }).eq("project_id", projectId).in("status_id", openStateIds)
        : { count: 0 },
      inProgressStateIds.length > 0
        ? supabase.from("issues").select("id", { count: "exact", head: true }).eq("project_id", projectId).in("status_id", inProgressStateIds)
        : { count: 0 },
    ]);

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
