import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NewIssueForm } from "@/components/issues/new-issue-form";
import { createClient } from "@/lib/supabase/server";
import { displayNameMap, personLabel } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "New issue" };

export default async function NewIssuePage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard");
  const projectId = context.activeProject.id;

  const supabase = await createClient();
  const [{ data: components }, { data: memberRows }, { data: states }, { data: role }] = await Promise.all([
    supabase.from("components").select("id, name").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase.from("workflow_states").select("name").eq("project_id", projectId).order("is_initial", { ascending: false }).order("position").limit(1),
    supabase.rpc("project_role", { p_project_id: projectId }),
  ]);

  if (role !== "REPORTER" && role !== "DEVELOPER" && role !== "MAINTAINER") redirect("/dashboard");

  const names = await displayNameMap((memberRows ?? []).map((row) => row.user_id));
  const members = (memberRows ?? []).map((row) => ({ userId: row.user_id, displayName: personLabel(names.get(row.user_id), row.user_id) }));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">New issue · {context.activeProject.key}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Report an issue</h1>
        <p className="mt-2 text-muted-foreground">Defaults: status {states?.[0]?.name ?? "Triage"}, P2, Major severity.</p>
      </div>
      <NewIssueForm
        projectId={projectId}
        projectKey={context.activeProject.key}
        components={components ?? []}
        members={members}
        initialStateName={states?.[0]?.name ?? "Triage"}
      />
    </main>
  );
}
