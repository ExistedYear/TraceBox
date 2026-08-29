import type { Metadata } from "next";
import Link from "next/link";

import { WorkspaceMembersManager, type WorkspaceInvitationRow, type WorkspaceMemberRow } from "@/components/settings/workspace-members-manager";
import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Workspace members" };

export default async function WorkspaceMembersPage() {
  const context = await getWorkspaceContext();
  const supabase = await createClient();
  const [{ data: rows, error: membersError }, { data: canManage, error: manageError }] = await Promise.all([
    supabase.from("organization_members").select("user_id, role, joined_at").eq("organization_id", context.activeOrganization.id).order("joined_at"),
    supabase.rpc("is_org_admin", { p_organization_id: context.activeOrganization.id }),
  ]);
  const names = await displayNameMap((rows ?? []).map((row) => row.user_id));
  const members: WorkspaceMemberRow[] = (rows ?? []).map((row) => ({ userId: row.user_id, role: row.role, joinedAt: row.joined_at, displayName: names.get(row.user_id) ?? null }));
  const invitationResult = await supabase.rpc("list_organization_invitations", { p_organization_id: context.activeOrganization.id });
  const loadError = membersError ?? manageError ?? invitationResult.error;
  if (loadError) {
    console.error("Workspace membership load failed", { code: loadError.code, message: loadError.message });
    return <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8"><Surface className="p-8 text-center"><h1 className="text-lg font-semibold">Workspace members unavailable</h1><p className="mt-2 text-sm text-muted-foreground">We could not load membership data. Try again in a moment.</p><Button asChild variant="outline" className="mt-5"><Link href="/dashboard/settings/members">Retry</Link></Button></Surface></div>;
  }
  const invitations = Array.isArray(invitationResult.data) ? invitationResult.data as WorkspaceInvitationRow[] : [];

  return <div className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8"><div className="mb-8"><p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">{context.activeOrganization.name} · Access</p><h1 className="text-3xl font-semibold tracking-tight">Workspace members</h1><p className="mt-2 text-sm text-muted-foreground">Invite collaborators, manage workspace roles, and transfer ownership safely.</p></div>{canManage ? <WorkspaceMembersManager organizationId={context.activeOrganization.id} currentUserId={context.userId} members={members} invitations={invitations} canManage /> : <Surface className="p-6"><p className="text-sm text-muted-foreground">You can view workspace membership, but only workspace administrators can manage access.</p><WorkspaceMembersManager organizationId={context.activeOrganization.id} currentUserId={context.userId} members={members} invitations={[]} canManage={false} /></Surface>}</div>;
}
