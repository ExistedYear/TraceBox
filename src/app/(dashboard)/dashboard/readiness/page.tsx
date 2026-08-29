import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { NewProjectButton } from "@/components/layout/workspace-switcher";
import { ReadinessDashboard, type ReadinessIssue } from "@/components/readiness/readiness-dashboard";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { formatIssueKey, personLabel } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = {
  title: "Release Readiness",
  description: "Automated release evaluation, blockers analysis, and risk scoring.",
};

export default async function ReadinessPage() {
  const context = await getWorkspaceContext();
  const supabase = await createClient();

  if (!context.activeProject) {
    return (
      <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <Surface className="p-12 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <FolderKanban className="h-6 w-6" />
          </span>
          <h2 className="text-base font-semibold">No project selected</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Select or create a project to assess release readiness.
          </p>
          <div className="mt-5 flex justify-center">
            <NewProjectButton organizationId={context.activeOrganization.id} />
          </div>
        </Surface>
      </main>
    );
  }

  const projectId = context.activeProject.id;
  const projectName = context.activeProject.name;
  const projectKey = context.activeProject.key;

  const [{ data: milestoneRows, error: milestonesError }, { data: versionRows, error: versionsError }] = await Promise.all([
    supabase
      .from("milestones")
      .select("id, name, status, due_at")
      .eq("project_id", projectId)
      .order("due_at", { ascending: true }),
    supabase
      .from("versions")
      .select("id, name, is_released")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("name"),
  ]);
  const issueRows: any[] = [];
  let issueError: { code?: string; message: string } | null = null;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("issues").select("id, issue_number, title, type, priority, severity, assignee_id, target_milestone_id, affected_version_id, status:workflow_states (name, category), component:components (name)").eq("project_id", projectId).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) { issueError = error; break; }
    issueRows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  if (milestonesError || versionsError || issueError) {
    const error = milestonesError ?? versionsError ?? issueError;
    console.error("Readiness load failed", { code: error?.code, message: error?.message });
    return <LoadErrorPage title="Readiness unavailable" description="We could not load the complete release dataset. No partial score is being shown." retryHref="/dashboard/readiness" />;
  }

  const rawIssues = issueRows;
  const assigneeIds = rawIssues.map((i) => i.assignee_id).filter(Boolean);
  const nameMap = await displayNameMap(assigneeIds);

  const issues: ReadinessIssue[] = rawIssues.map((row: any) => ({
    id: row.id,
    issueNumber: row.issue_number,
    keyLabel: formatIssueKey(projectKey, row.issue_number),
    title: row.title,
    type: row.type,
    priority: row.priority,
    severity: row.severity,
    statusCategory: row.status?.category ?? "OPEN",
    statusName: row.status?.name ?? "Open",
    assigneeId: row.assignee_id ?? null,
    assigneeLabel: personLabel(nameMap.get(row.assignee_id ?? ""), row.assignee_id),
    componentName: row.component?.name ?? null,
    targetMilestoneId: row.target_milestone_id ?? null,
    affectedVersionId: row.affected_version_id ?? null,
  }));

  const milestones = (milestoneRows ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    status: m.status,
    dueAt: m.due_at ?? null,
  }));

  const versions = (versionRows ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    isReleased: Boolean(v.is_released),
  }));

  return (
    <ReadinessDashboard
      projectName={projectName}
      projectKey={projectKey}
      issues={issues}
      milestones={milestones}
      versions={versions}
    />
  );
}
