import type { Metadata } from "next";
import Link from "next/link";

import { ProjectMembersManager, type ProjectInvitation, type ProjectMemberCandidate } from "@/components/settings/project-members-manager";
import { EmptyState, Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { FolderKanban } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Project contributors" };

export default async function ContributorsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) return <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8"><EmptyState icon={FolderKanban} title="No project selected" description="Choose a project from the sidebar to manage contributors." /></div>;
  const supabase = await createClient();
  const [{ data: orgRows, error: orgError }, { data: projectRows, error: projectError }, { data: canManage, error: manageError }] = await Promise.all([
    supabase.from("organization_members").select("user_id, role").eq("organization_id", context.activeOrganization.id),
    supabase.from("project_members").select("user_id, role").eq("project_id", context.activeProject.id),
    supabase.rpc("can_manage_project", { p_project_id: context.activeProject.id }),
  ]);
  const invitationResult = await supabase.rpc("list_project_invitations", { p_project_id: context.activeProject.id });
  const loadError = orgError ?? projectError ?? manageError ?? invitationResult.error;
  if (loadError) {
    console.error("Project contributors load failed", { code: loadError.code, message: loadError.message });
    return <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8"><Surface className="p-8 text-center"><h1 className="text-lg font-semibold">Contributors unavailable</h1><p className="mt-2 text-sm text-muted-foreground">We could not load project access. Try again in a moment.</p><Button asChild variant="outline" className="mt-5"><Link href="/dashboard/settings/contributors">Retry</Link></Button></Surface></div>;
  }
  const names = await displayNameMap((orgRows ?? []).map((row) => row.user_id));
  const projectRoles = new Map((projectRows ?? []).map((row) => [row.user_id, row.role]));
  const members: ProjectMemberCandidate[] = (orgRows ?? []).map((row) => ({ userId: row.user_id, role: projectRoles.get(row.user_id) ?? null, organizationRole: row.role, displayName: names.get(row.user_id) ?? null }));
  const pendingInvitations = Array.isArray(invitationResult.data) ? invitationResult.data as ProjectInvitation[] : [];
  return <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8"><div className="mb-8"><p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">{context.activeProject.key} · People</p><h1 className="text-3xl font-semibold tracking-tight">Contributors</h1><p className="mt-2 text-sm text-muted-foreground">Manage who can access {context.activeProject.name} and what they can do.</p></div><ProjectMembersManager organizationId={context.activeOrganization.id} projectId={context.activeProject.id} members={members} pendingInvitations={pendingInvitations} canManage={Boolean(canManage)} canInvite={Boolean(canManage)} /></div>;
}
