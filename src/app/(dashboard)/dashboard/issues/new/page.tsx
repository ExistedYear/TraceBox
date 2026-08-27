import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewIssueForm } from "@/components/issues/new-issue-form";
import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "New issue" };

export default async function NewIssuePage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard");
  const projectId = context.activeProject.id;

  const supabase = await createClient();
  const [{ data: components }, { data: memberRows }, { data: adminRows }, { data: states }, { data: role }, { data: templateRows }] = await Promise.all([
    supabase.from("components").select("id, name, default_assignee_id").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase.from("organization_members").select("user_id").eq("organization_id", context.activeOrganization.id).in("role", ["OWNER", "ADMIN"]),
    supabase.from("workflow_states").select("name").eq("project_id", projectId).order("is_initial", { ascending: false }).order("position").limit(1),
    supabase.rpc("project_role", { p_project_id: projectId }),
    supabase.from("issue_templates").select("id, name, description, issue_type, body_template, default_priority, default_severity, default_component_id").eq("project_id", projectId).order("name"),
  ]);

  if (role !== "REPORTER" && role !== "DEVELOPER" && role !== "MAINTAINER") redirect("/dashboard");

  const candidates = [...(memberRows ?? []), ...(adminRows ?? [])];
  const names = await displayNameMap(candidates.map((row) => row.user_id));
  const members = [...new Map(candidates.map((row) => [row.user_id, { userId: row.user_id, displayName: personLabel(names.get(row.user_id), row.user_id) }])).values()];

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">New issue · {context.activeProject.key}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Report an issue</h1>
        <p className="mt-2 text-muted-foreground">Defaults: status {states?.[0]?.name ?? "Triage"}, P2, Major severity.</p>
      </div>
      <NewIssueForm
        key={projectId}
        projectId={projectId}
        projectKey={context.activeProject.key}
        components={(components ?? []).map((component) => ({ id: component.id, name: component.name, defaultAssigneeId: component.default_assignee_id }))}
        members={members}
        templates={(templateRows ?? []).map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description ?? null,
          issue_type: t.issue_type,
          body_template: t.body_template,
          default_priority: t.default_priority ?? null,
          default_severity: t.default_severity ?? null,
          default_component_id: t.default_component_id ?? null,
        }))}
        initialStateName={states?.[0]?.name ?? "Triage"}
      />
    </main>
  );
}
