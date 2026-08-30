import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { ArchivedProjects, ProjectAdministration } from "@/components/settings/project-administration";
import { ProjectSettings, type StateRow } from "@/components/settings/project-settings";
import { ProjectMembersManager } from "@/components/settings/project-members-manager";
import { NewProjectButton, ProjectCardLink } from "@/components/layout/workspace-switcher";
import { EmptyState, Surface } from "@/components/tracebox/primitives";
import { LoadError } from "@/components/tracebox/load-error";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Project settings" };

export default async function SettingsPage() {
  const context = await getWorkspaceContext();
  const supabase = await createClient();
  if (!context.activeProject) {
    const [archivedResult, organizationRoleResult, maintainerResult] = await Promise.all([
      supabase.from("projects").select("id, key, name").eq("organization_id", context.activeOrganization.id).eq("is_archived", true).order("name"),
      supabase.from("organization_members").select("role").eq("organization_id", context.activeOrganization.id).eq("user_id", context.userId).maybeSingle(),
      supabase.from("project_members").select("project_id, role").eq("user_id", context.userId).eq("role", "MAINTAINER"),
    ]);
    const archivedError = archivedResult.error ?? organizationRoleResult.error ?? maintainerResult.error;
    if (archivedError) {
      console.error("Archived project settings load failed", { code: archivedError.code, message: archivedError.message });
      return <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><LoadError title="Project settings unavailable" description="We could not load active and archived projects for this workspace." retryHref="/dashboard/settings" /></div>;
    }
    const canRestoreAll = organizationRoleResult.data?.role === "OWNER" || organizationRoleResult.data?.role === "ADMIN";
    const maintainableIds = new Set((maintainerResult.data ?? []).map((row) => row.project_id));
    const restorableProjects = (archivedResult.data ?? []).filter((project) => canRestoreAll || maintainableIds.has(project.id));
    return (
      <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
        <Surface className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Project administration</p><h1 className="mt-1 text-xl font-semibold">Choose a project</h1><p className="mt-1 text-sm text-muted-foreground">Project settings apply to one project at a time.</p></div>{canRestoreAll ? <NewProjectButton organizationId={context.activeOrganization.id} /> : null}</div>{context.projects.length > 0 ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{context.projects.map((project) => <ProjectCardLink key={project.id} project={project} />)}</div> : <EmptyState icon={FolderKanban} title="No active projects" description={canRestoreAll ? "Create a project or restore one below." : "Ask a workspace administrator to create or restore a project."} />}</Surface>
        <ArchivedProjects projects={restorableProjects} />
      </div>
    );
  }

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
    { data: archivedProjects, error: archivedProjectsError },
    { data: maintainedProjects, error: maintainedProjectsError },
  ] = await Promise.all([
    supabase.from("projects").select("name, key, description, is_archived").eq("id", projectId).maybeSingle(),
    supabase.from("components").select("*").eq("project_id", projectId).order("name"),
    supabase.from("labels").select("*").eq("project_id", projectId).order("name"),
    supabase.from("versions").select("*").eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("milestones").select("*").eq("project_id", projectId).order("due_at", { ascending: true }),
    supabase.from("workflow_states").select("*").eq("project_id", projectId).order("position"),
    supabase.from("workflow_transitions").select("from_state_id, to_state_id, required_role, requires_resolution").eq("project_id", projectId),
    supabase.from("project_members").select("user_id, role").eq("project_id", projectId),
    supabase.from("organization_members").select("user_id, role").eq("organization_id", context.activeOrganization.id).in("role", ["OWNER", "ADMIN"]),
    supabase.from("organization_members").select("user_id, role").eq("organization_id", context.activeOrganization.id),
    supabase.rpc("can_manage_project", { p_project_id: projectId }),
    supabase.from("projects").select("id, key, name").eq("organization_id", context.activeOrganization.id).eq("is_archived", true).order("name"),
    supabase.from("project_members").select("project_id").eq("user_id", context.userId).eq("role", "MAINTAINER"),
  ]);

  const loadError = projectError ?? componentsError ?? labelsError ?? versionsError ?? milestonesError ?? statesError ?? transitionsError ?? membersError ?? adminsError ?? organizationMembersError ?? manageError ?? archivedProjectsError ?? maintainedProjectsError;
  if (loadError) {
    console.error("Project settings load failed", { code: loadError.code, message: loadError.message });
    return <div className="mx-auto max-w-[1500px]"><Surface className="p-8 text-center"><h1 className="text-lg font-semibold">Project settings unavailable</h1><p className="mt-2 text-sm text-muted-foreground">We could not load the complete project configuration. Try again in a moment.</p><Button asChild variant="outline" className="mt-5"><Link href="/dashboard/settings">Retry</Link></Button></Surface></div>;
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
  const viewerOrganizationRole = (organizationMemberRows ?? []).find((row) => row.user_id === context.userId)?.role;
  const canRestoreAll = viewerOrganizationRole === "OWNER" || viewerOrganizationRole === "ADMIN";
  const maintainableProjectIds = new Set((maintainedProjects ?? []).map((row) => row.project_id));
  const restorableProjects = (archivedProjects ?? []).filter((archivedProject) => canRestoreAll || maintainableProjectIds.has(archivedProject.id));

  return (
    <div className="space-y-6">
      <ProjectAdministration project={{ id: projectId, key: project.key, name: project.name, description: project.description, isArchived: project.is_archived }} canManage={Boolean(canManage)} />
      <ProjectSettings
        key={projectId}
        projectId={projectId}
        project={{ key: project.key, name: project.name, description: project.description }}
        canManage={Boolean(canManage)}
        initialComponents={components ?? []}
        initialLabels={labels ?? []}
        initialVersions={versions ?? []}
        initialMilestones={milestones ?? []}
        states={(states ?? []).map(({ id, name, category, position, color, is_initial, is_terminal }) => ({ id, name, category: category as StateRow["category"], position, color, isInitial: is_initial, isTerminal: is_terminal }))}
        transitions={(transitions ?? []).map(({ from_state_id, to_state_id, required_role, requires_resolution }) => ({ fromStateId: from_state_id, toStateId: to_state_id, requiredRole: required_role, requiresResolution: requires_resolution }))}
        members={members}
      />
      <ProjectMembersManager organizationId={context.activeOrganization.id} projectId={projectId} members={contributorCandidates} canManage={Boolean(canManage)} canInvite={Boolean(canManage)} />
      {restorableProjects.length > 0 && <ArchivedProjects projects={restorableProjects} />}
    </div>
  );
}
