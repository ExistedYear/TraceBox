import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { ProjectSettings } from "@/components/settings/project-settings";
import { EmptyState } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/server";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Project settings" };

export default async function SettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) {
    return (
      <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <EmptyState
          icon={FolderKanban}
          title="No project selected"
          description="Pick a project from the sidebar switcher to manage its components and workflow."
        />
      </main>
    );
  }

  const supabase = await createClient();
  const projectId = context.activeProject.id;

  const [
    { data: project },
    { data: components },
    { data: labels },
    { data: versions },
    { data: milestones },
    { data: states },
    { data: transitions },
    { data: memberRows },
    { data: adminRows },
    { data: canManage },
  ] = await Promise.all([
    supabase.from("projects").select("name, key, description").eq("id", projectId).maybeSingle(),
    supabase.from("components").select("*").eq("project_id", projectId).order("name"),
    supabase.from("labels").select("*").eq("project_id", projectId).order("name"),
    supabase.from("versions").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("milestones").select("*").eq("project_id", projectId).order("due_at", { ascending: true }),
    supabase.from("workflow_states").select("*").eq("project_id", projectId).order("position"),
    supabase.from("workflow_transitions").select("from_state_id, to_state_id").eq("project_id", projectId),
    supabase.from("project_members").select("user_id, role").eq("project_id", projectId),
    supabase.from("organization_members").select("user_id, role").eq("organization_id", context.activeOrganization.id).in("role", ["OWNER", "ADMIN"]),
    supabase.rpc("can_manage_project", { p_project_id: projectId }),
  ]);

  if (!project) redirect("/dashboard");

  const candidates = [...(memberRows ?? []), ...(adminRows ?? [])];
  const names = await displayNameMap(candidates.map((row) => row.user_id));
  const members = [...new Map(candidates.map((row) => [row.user_id, {
    userId: row.user_id,
    role: row.role,
    displayName: names.get(row.user_id) ?? null,
  }])).values()];

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <ProjectSettings
        key={projectId}
        projectId={projectId}
        project={{ key: project.key, name: project.name, description: project.description }}
        canManage={Boolean(canManage)}
        initialComponents={components ?? []}
        initialLabels={labels ?? []}
        initialVersions={versions ?? []}
        initialMilestones={milestones ?? []}
        states={(states ?? []).map(({ id, name, category, position, is_initial, is_terminal }) => ({ id, name, category, position, isInitial: is_initial, isTerminal: is_terminal }))}
        transitions={(transitions ?? []).map(({ from_state_id, to_state_id }) => ({ fromStateId: from_state_id, toStateId: to_state_id }))}
        members={members}
      />
    </main>
  );
}
