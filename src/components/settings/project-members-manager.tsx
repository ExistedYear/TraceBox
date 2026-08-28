"use client";

import { useState } from "react";
import { Copy, Loader2, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type FunctionName = keyof Database["public"]["Functions"];
type FunctionArgs<Name extends FunctionName> = Database["public"]["Functions"][Name]["Args"];
async function call<Name extends FunctionName>(name: Name, args: FunctionArgs<Name>) { try { return await createClient().rpc(name, args); } catch { return { data: null, error: { message: "NETWORK" } }; } }

export type ProjectMemberCandidate = { userId: string; role: string | null; organizationRole: string; displayName: string | null; avatarUrl?: string | null };
export type ProjectInvitation = { id: string; email: string; project_id: string | null; project_role: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null };

function errorText(message?: string | null) {
  if (message === "NETWORK") return "Could not reach the server. Try again.";
  if (message?.includes("ROLE_ABOVE_AUTHORITY")) return "You cannot grant a role above your own authority.";
  if (message?.includes("INVALID_MEMBER")) return "That person is not an active workspace member.";
  return "The project membership change could not be completed.";
}

export function ProjectMembersManager({ organizationId, projectId, members: initialMembers, pendingInvitations = [], canManage, canInvite = false }: { organizationId: string; projectId: string; members: ProjectMemberCandidate[]; pendingInvitations?: ProjectInvitation[]; canManage: boolean; canInvite?: boolean }) {
  const [members, setMembers] = useState(initialMembers);
  const [selected, setSelected] = useState("");
  const [selectedRole, setSelectedRole] = useState("DEVELOPER");
  const [inviteEmail, setInviteEmail] = useState("");
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [pending, setPending] = useState(pendingInvitations);
  const [busy, setBusy] = useState<string | null>(null);
  const hasAccess = (member: ProjectMemberCandidate) => Boolean(member.role) || member.organizationRole === "OWNER" || member.organizationRole === "ADMIN";
  const available = members.filter((member) => !hasAccess(member));

  async function copyInvitationLink() {
    try { await navigator.clipboard.writeText(lastInviteLink); toast.success("Invitation link copied."); } catch { toast.error("Could not copy the link. Select and copy it manually."); }
  }

  async function addMember() {
    if (!selected) return;
    setBusy("add");
    const result = await call("add_project_member", { p_project_id: projectId, p_user_id: selected, p_role: selectedRole });
    setBusy(null);
    if (result.error) { toast.error(errorText(result.error.message)); return; }
    setMembers((current) => current.map((member) => member.userId === selected ? { ...member, role: selectedRole } : member));
    setSelected("");
    toast.success("Project access granted.");
  }

  async function inviteMember() {
    if (!canInvite || !inviteEmail.trim()) return;
    setBusy("invite");
    const result = await call("create_organization_invitation", { p_organization_id: organizationId, p_email: inviteEmail.trim(), p_organization_role: "MEMBER", p_project_id: projectId, p_project_role: selectedRole });
    setBusy(null);
    if (result.error) { toast.error(result.error.message.includes("VALIDATION") ? "Enter a valid email address." : errorText(result.error.message)); return; }
    const invitation = (Array.isArray(result.data) ? result.data[0] : result.data) as { token?: string } | undefined;
    if (!invitation?.token) { toast.error("Invitation could not be created."); return; }
    const link = `${window.location.origin}/invite/${invitation.token}`;
    setInviteEmail("");
    setLastInviteLink(link);
    try { await navigator.clipboard.writeText(link); toast.success("Project invitation created and link copied."); } catch { toast.success("Project invitation created. Use the link shown below."); }
  }

  async function changeRole(member: ProjectMemberCandidate, nextRole: string) {
    setBusy(member.userId);
    const result = await call("update_project_member_role", { p_project_id: projectId, p_user_id: member.userId, p_role: nextRole });
    setBusy(null);
    if (result.error) { toast.error(errorText(result.error.message)); return; }
    setMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role: nextRole } : item));
    toast.success("Project role updated.");
  }

  async function remove(member: ProjectMemberCandidate) {
    if (!window.confirm("Remove this person's access to the project?")) return;
    setBusy(member.userId);
    const result = await call("remove_project_member", { p_project_id: projectId, p_user_id: member.userId });
    setBusy(null);
    if (result.error) { toast.error(errorText(result.error.message)); return; }
    setMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role: null } : item));
    toast.success("Project access removed.");
  }

  async function revokeInvitation(invitationId: string) {
    setBusy(invitationId);
    const result = await call("revoke_organization_invitation", { p_invitation_id: invitationId });
    setBusy(null);
    if (result.error) { toast.error(errorText(result.error.message)); return; }
    setPending((current) => current.map((item) => item.id === invitationId ? { ...item, revoked_at: new Date().toISOString() } : item));
    toast.success("Invitation revoked.");
  }

  return <Surface className="mt-6"><div className="border-b border-border/70 px-4 py-3"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Project contributors</h2><p className="text-xs text-muted-foreground">Assign workspace members to this project and control their role.</p></div></div></div>{canManage && <div className="space-y-2 border-b border-border/70 p-4"><div className="flex flex-wrap gap-2"><select aria-label="Workspace member to add" className="h-8 min-w-44 flex-1 rounded-md border border-input bg-background px-2 text-xs" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Add workspace member…</option>{available.map((member) => <option key={member.userId} value={member.userId}>{member.displayName ?? member.userId.slice(0, 8)}</option>)}</select><select aria-label="New contributor role" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}><option value="MAINTAINER">Maintainer</option><option value="DEVELOPER">Developer</option><option value="REPORTER">Reporter</option><option value="VIEWER">Viewer</option></select><Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void addMember()} disabled={!selected || busy === "add"}>{busy === "add" ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Add</Button></div>{canInvite && <><div className="flex flex-wrap gap-2"><input aria-label="Invite contributor email" className="h-8 min-w-44 flex-1 rounded-md border border-input bg-background px-2 text-xs" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="Invite by email…" /><Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void inviteMember()} disabled={!inviteEmail.trim() || busy === "invite"}>{busy === "invite" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />} Invite</Button></div>{lastInviteLink && <div className="flex gap-2"><input aria-label="Latest project invitation link" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" readOnly value={lastInviteLink} /><Button variant="outline" size="icon" aria-label="Copy project invitation link" onClick={() => void copyInvitationLink()}><Copy className="h-4 w-4" /></Button></div>}</>}</div>}
    <div className="divide-y divide-border/70">{members.filter(hasAccess).map((member) => <div key={member.userId} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="flex min-w-0 flex-1 items-center gap-2"><Avatar className="h-7 w-7"><AvatarImage src={member.avatarUrl ?? undefined} alt="" /><AvatarFallback>{(member.displayName ?? "?").slice(0, 1).toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate text-sm font-medium">{member.displayName ?? member.userId.slice(0, 8)}</p><p className="font-mono text-[10px] text-muted-foreground">{member.organizationRole} · {member.role ?? "workspace access"}</p></div></div>{canManage && member.role ? <><select aria-label={`Project role for ${member.displayName ?? member.userId}`} className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={member.role} onChange={(event) => void changeRole(member, event.target.value)} disabled={busy === member.userId}><option value="MAINTAINER">Maintainer</option><option value="DEVELOPER">Developer</option><option value="REPORTER">Reporter</option><option value="VIEWER">Viewer</option></select><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => void remove(member)} disabled={busy === member.userId} aria-label="Remove project member">{busy === member.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}</Button></> : <span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{member.role ?? member.organizationRole}</span>}</div>)}{members.every((member) => !hasAccess(member)) && <p className="px-4 py-6 text-sm text-muted-foreground">No contributors assigned yet.</p>}</div>{canManage && <div className="border-t border-border/70 px-4 py-3"><p className="text-xs font-semibold">Pending invitations</p>{pending.filter((invitation) => invitation.project_id === projectId && !invitation.accepted_at && !invitation.revoked_at).length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No pending project invitations.</p> : pending.filter((invitation) => invitation.project_id === projectId && !invitation.accepted_at && !invitation.revoked_at).map((invitation) => <div key={invitation.id} className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">{invitation.email} · {invitation.project_role} · expires {new Date(invitation.expires_at).toLocaleDateString()}</span><Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => void revokeInvitation(invitation.id)} disabled={busy === invitation.id}>Revoke</Button></div>)}</div>}</Surface>;
}
