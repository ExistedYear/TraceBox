import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { ProjectSettings } from "@/components/settings/project-settings";
import { ProjectMembersManager } from "@/components/settings/project-members-manager";
import { EmptyState, Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
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
    { data: project, error: projectError },
    { data: components, error: componentsError },
    { data: labels, error: labelsError },
    { data: versions, error: versionsError },
    { data: milestones, error: milestonesError },
    { data: states, error: statesError },
    { data: transitions, error: transitionsError },
    { data: memberRows, error: membersError },
    { data: adminRows, error: adminsError },
    { data: organizationMemberRows, error: organizationMembersError },
    { data: canManage, error: manageError },
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
    supabase.from("organization_members").select("user_id, role").eq("organization_id", context.activeOrganization.id),
    supabase.rpc("can_manage_project", { p_project_id: projectId }),
  ]);

  const loadError = projectError ?? componentsError ?? labelsError ?? versionsError ?? milestonesError ?? statesError ?? transitionsError ?? membersError ?? adminsError ?? organizationMembersError ?? manageError;
  if (loadError) {
    console.error("Project settings load failed", { code: loadError.code, message: loadError.message });
    return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><Surface className="p-8 text-center"><h1 className="text-lg font-semibold">Project settings unavailable</h1><p className="mt-2 text-sm text-muted-foreground">We could not load the complete project configuration. Try again in a moment.</p><Button asChild variant="outline" className="mt-5"><Link href="/dashboard/settings">Retry</Link></Button></Surface></main>;
  }

  if (!project) redirect("/dashboard");

  const candidates = [...(memberRows ?? []), ...(adminRows ?? [])];
  const names = await displayNameMap(candidates.map((row) => row.user_id));
  const members = [...new Map(candidates.map((row) => [row.user_id, {
    userId: row.user_id,
    role: row.role,
    displayName: names.get(row.user_id) ?? null,
  }])).values()];
  const organizationNames = await displayNameMap((organizationMemberRows ?? []).map((row) => row.user_id));
  const projectMemberIds = new Map((memberRows ?? []).map((row) => [row.user_id, row.role]));
  const contributorCandidates = (organizationMemberRows ?? []).map((row) => ({
    userId: row.user_id,
    role: projectMemberIds.get(row.user_id) ?? null,
    organizationRole: row.role,
    displayName: organizationNames.get(row.user_id) ?? null,
  }));

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
      <ProjectMembersManager organizationId={context.activeOrganization.id} projectId={projectId} members={contributorCandidates} canManage={Boolean(canManage)} canInvite={Boolean(canManage)} />
    </main>
  );
}
