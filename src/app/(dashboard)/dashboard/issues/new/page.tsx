import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NewIssueForm } from "@/components/issues/new-issue-form";
import { Surface } from "@/components/tracebox/primitives";
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
  const results = await Promise.all([
    supabase.from("components").select("id, name, default_assignee_id").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase.from("organization_members").select("user_id").eq("organization_id", context.activeOrganization.id).in("role", ["OWNER", "ADMIN"]),
    supabase.from("workflow_states").select("name").eq("project_id", projectId).order("is_initial", { ascending: false }).order("position").limit(1),
    supabase.rpc("project_role", { p_project_id: projectId }),
    (supabase.from("issue_templates") as any).select("id, name, description, issue_type, body_template, default_priority, default_severity, default_component_id").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("custom_fields").select("id, name, field_type, config, is_required").eq("project_id", projectId).order("name"),
  ]);
  const [{ data: components, error: componentsError }, { data: memberRows, error: memberError }, { data: adminRows, error: adminsError }, { data: states, error: statesError }, { data: role, error: roleError }, { data: templateRows, error: templatesError }, { data: customFieldRows, error: customFieldsError }] = results;

  const queryError = componentsError ?? memberError ?? adminsError ?? statesError ?? roleError ?? templatesError ?? customFieldsError;
  if (queryError) {
    console.error("New issue metadata query failed", { code: queryError.code, message: queryError.message });
    return <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8"><Surface className="space-y-3 border-destructive/30 p-8 text-center"><h1 className="text-lg font-semibold">Issue form unavailable</h1><p className="text-sm text-muted-foreground">Project metadata could not be loaded. No issue was created.</p><Link href="/dashboard/issues/new" className="text-sm font-medium text-primary underline underline-offset-4">Retry</Link></Surface></main>;
  }

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
        templates={(templateRows ?? []).map((t: { id: string; name: string; description: string | null; issue_type: string; body_template: string; default_priority: string | null; default_severity: string | null; default_component_id: string | null }) => ({
          id: t.id,
          name: t.name,
          description: t.description ?? null,
          issue_type: t.issue_type,
          body_template: t.body_template,
          default_priority: t.default_priority ?? null,
          default_severity: t.default_severity ?? null,
          default_component_id: t.default_component_id ?? null,
        }))}
        requiredCustomFields={(customFieldRows ?? []).map((field) => ({ id: field.id, name: field.name, field_type: field.field_type, config: (field.config ?? {}) as Record<string, unknown>, is_required: field.is_required ?? false }))}
        initialStateName={states?.[0]?.name ?? "Triage"}
      />
    </main>
  );
}
