import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { NewProjectButton } from "@/components/layout/workspace-switcher";
import { TriageInbox, type TriageIssue } from "@/components/triage/triage-inbox";
import { createClient } from "@/lib/supabase/server";
import { formatIssueKey, personLabel } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = {
  title: "Triage Inbox",
  description: "Review, classify, and triage incoming bugs and tasks.",
};

export default async function TriagePage() {
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
            Select or create a project to triage incoming issues.
          </p>
          <div className="mt-5 flex justify-center">
            <NewProjectButton organizationId={context.activeOrganization.id} />
          </div>
        </Surface>
      </main>
    );
  }

  const projectId = context.activeProject.id;
  const projectKey = context.activeProject.key;

  // Concurrently fetch workflow states, triage issues, members, and permissions
  const [
    { data: workflowStates },
    { data: memberRows },
    { data: canManage },
  ] = await Promise.all([
    supabase
      .from("workflow_states")
      .select("id, name, category, position")
      .eq("project_id", projectId)
      .order("position"),
    supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId),
    supabase.rpc("can_manage_project", { p_project_id: projectId }),
  ]);

  const states = workflowStates ?? [];
  const triageStateIds = states.filter((s) => s.category === "TRIAGE").map((s) => s.id);
  const openState = states.find((s) => s.category === "OPEN" || s.category === "IN_PROGRESS");
  const closedState = states.find((s) => s.category === "CLOSED" || s.category === "RESOLVED");

  // Fetch triage issues
  let issuesData: any[] = [];
  if (triageStateIds.length > 0) {
    const { data } = await supabase
      .from("issues")
      .select("*, component:components (id, name), status:workflow_states (name, category)")
      .eq("project_id", projectId)
      .in("status_id", triageStateIds)
      .order("created_at", { ascending: true });
    issuesData = data ?? [];
  }

  // Resolve user display names
  const userIds = [
    ...issuesData.map((i) => i.reporter_id),
    ...issuesData.map((i) => i.assignee_id).filter(Boolean),
    ...(memberRows ?? []).map((m) => m.user_id),
  ];
  const nameMap = await displayNameMap(userIds);

  const formattedIssues: TriageIssue[] = issuesData.map((i) => ({
    id: i.id,
    issueNumber: i.issue_number,
    keyLabel: formatIssueKey(projectKey, i.issue_number),
    title: i.title,
    description: i.description,
    type: i.type,
    priority: i.priority,
    severity: i.severity,
    statusId: i.status_id,
    statusName: i.status?.name ?? "Triage",
    statusCategory: i.status?.category ?? "TRIAGE",
    componentId: i.component_id,
    componentName: i.component?.name ?? null,
    assigneeId: i.assignee_id,
    assigneeLabel: personLabel(nameMap.get(i.assignee_id ?? ""), i.assignee_id),
    reporterId: i.reporter_id,
    reporterLabel: personLabel(nameMap.get(i.reporter_id), i.reporter_id),
    environment: i.environment,
    stepsToReproduce: i.steps_to_reproduce,
    expectedBehavior: i.expected_behavior,
    actualBehavior: i.actual_behavior,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  }));

  const members = (memberRows ?? []).map((m) => ({
    userId: m.user_id,
    displayName: nameMap.get(m.user_id) ?? null,
  }));

  return (
    <TriageInbox
      projectId={projectId}
      projectKey={projectKey}
      issues={formattedIssues}
      openStateId={openState?.id ?? null}
      closedStateId={closedState?.id ?? null}
      workflowStates={states.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
      members={members}
      canManage={Boolean(canManage)}
    />
  );
}
