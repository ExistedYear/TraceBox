"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, LogOut, Mail, Shield, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { formatDate } from "@/lib/date-format";

type FunctionName = keyof Database["public"]["Functions"];
type FunctionArgs<Name extends FunctionName> = Database["public"]["Functions"][Name]["Args"];
async function call<Name extends FunctionName>(name: Name, args: FunctionArgs<Name>) { try { return await createClient().rpc(name, args); } catch { return { data: null, error: { message: "NETWORK" } }; } }

export type WorkspaceMemberRow = { userId: string; role: string; displayName: string | null; joinedAt?: string };
export type WorkspaceInvitationRow = { id: string; email: string; organization_role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null };

function safeError(message?: string | null) {
  if (message === "NETWORK") return "Could not reach the server. Try again.";
  if (message?.includes("ROLE_ABOVE_AUTHORITY")) return "You cannot grant a role above your own authority.";
  if (message?.includes("LAST_OWNER")) return "The workspace must always have an owner.";
  if (message?.includes("OWNER_TRANSFER_REQUIRED")) return "Transfer ownership before changing the owner's role.";
  return "That workspace change could not be completed.";
}

export function WorkspaceMembersManager({ organizationId, currentUserId, members: initialMembers, invitations: initialInvitations, canManage }: { organizationId: string; currentUserId: string; members: WorkspaceMemberRow[]; invitations: WorkspaceInvitationRow[]; canManage: boolean }) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState("");
  const owner = members.find((member) => member.role === "OWNER");
  const currentMember = members.find((member) => member.userId === currentUserId);

  async function copyInvitationLink() {
    try { await navigator.clipboard.writeText(lastInviteLink); toast.success("Invitation link copied."); } catch { toast.error("Could not copy the link. Select and copy it manually."); }
  }

  async function invite() {
    setBusy("invite");
    const response = await fetch("/api/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, email, organizationRole: role }) });
    const result = await response.json().catch(() => ({})) as { invitation?: { id: string; email: string; expires_at: string; link: string }; emailSent?: boolean; error?: string };
    setBusy(null);
    if (!response.ok || result.error) { toast.error(result.error ?? "Invitation could not be created."); return; }
    const invitation = result.invitation;
    if (!invitation) { toast.error("Invitation could not be created."); return; }
    const link = invitation.link;
    setLastInviteLink(link);
    setInvitations((current) => [{ id: invitation.id, email: invitation.email, organization_role: role, expires_at: invitation.expires_at, accepted_at: null, revoked_at: null }, ...current]);
    setEmail("");
    try { await navigator.clipboard.writeText(link); toast.success(result.emailSent ? "Invitation email sent and link copied." : "Invitation created. Email delivery was unavailable, so the link was copied."); } catch { toast.success(result.emailSent ? "Invitation email sent." : "Invitation created. Share the link shown below."); }
  }

  async function changeRole(userId: string, nextRole: string) {
    setBusy(userId);
    const result = await call("update_organization_member_role", { p_organization_id: organizationId, p_user_id: userId, p_role: nextRole });
    setBusy(null);
    if (result.error) { toast.error(safeError(result.error.message)); return; }
    setMembers((current) => current.map((member) => member.userId === userId ? { ...member, role: nextRole } : member));
    toast.success("Workspace role updated.");
  }

  async function remove(userId: string) {
    if (!window.confirm("Remove this person from the workspace and all of its projects?")) return;
    setBusy(userId);
    const result = await call("remove_organization_member", { p_organization_id: organizationId, p_user_id: userId });
    setBusy(null);
    if (result.error) { toast.error(safeError(result.error.message)); return; }
    setMembers((current) => current.filter((member) => member.userId !== userId));
    toast.success("Workspace access removed.");
  }

  async function transfer(userId: string) {
    if (!window.confirm("Transfer workspace ownership? You will become an admin.")) return;
    setBusy("transfer");
    const result = await call("transfer_organization_ownership", { p_organization_id: organizationId, p_new_owner_id: userId });
    setBusy(null);
    if (result.error) { toast.error(safeError(result.error.message)); return; }
    setMembers((current) => current.map((member) => member.userId === userId ? { ...member, role: "OWNER" } : member.userId === currentUserId ? { ...member, role: "ADMIN" } : member));
    toast.success("Workspace ownership transferred.");
  }

  async function revoke(invitationId: string) {
    setBusy(invitationId);
    const result = await call("revoke_organization_invitation", { p_invitation_id: invitationId });
    setBusy(null);
    if (result.error) { toast.error(safeError(result.error.message)); return; }
    setInvitations((current) => current.map((invitation) => invitation.id === invitationId ? { ...invitation, revoked_at: new Date().toISOString() } : invitation));
  }

  async function leaveWorkspace() {
    if (!window.confirm("Leave this workspace and lose access to all of its projects?")) return;
    setBusy("leave");
    const result = await call("leave_organization", { p_organization_id: organizationId });
    if (result.error) {
      setBusy(null);
      toast.error(safeError(result.error.message));
      return;
    }
    document.cookie = "tb_org=; path=/; max-age=0; samesite=lax";
    document.cookie = "tb_project=; path=/; max-age=0; samesite=lax";
    toast.success("You left the workspace.");
    router.replace("/dashboard");
    router.refresh();
  }

  return <div className="space-y-6">
    {canManage && <Surface className="p-4">
      <div className="mb-4 flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Invite to workspace</h2><p className="text-xs text-muted-foreground">TraceBox emails a secure, single-use link and keeps a copy available here.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
        <div className="space-y-2"><Label htmlFor="workspace-invite-email">Email</Label><Input id="workspace-invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" /></div>
        <div className="space-y-2"><Label htmlFor="workspace-invite-role">Role</Label><select id="workspace-invite-role" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={role} onChange={(event) => setRole(event.target.value)}><option value="ADMIN">Admin</option><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option></select></div>
        <Button onClick={() => void invite()} disabled={!email.trim() || busy === "invite"} className="h-9">{busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create invite"}</Button>
      </div>
      {lastInviteLink && <div className="mt-3 flex gap-2"><Input aria-label="Latest invitation link" readOnly value={lastInviteLink} /><Button variant="outline" size="icon" aria-label="Copy invitation link" onClick={() => void copyInvitationLink()}><Copy className="h-4 w-4" /></Button></div>}
    </Surface>}

    <Surface><div className="border-b border-border/70 px-4 py-3"><h2 className="text-sm font-semibold">Workspace members</h2><p className="text-xs text-muted-foreground">{members.length} active member{members.length === 1 ? "" : "s"}</p></div><div className="divide-y divide-border/70">{members.map((member) => <div key={member.userId} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="flex min-w-0 flex-1 items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{(member.displayName ?? "?").slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{member.displayName ?? member.userId.slice(0, 8)}</p><p className="font-mono text-[10px] text-muted-foreground">{member.userId === currentUserId ? "You" : member.userId.slice(0, 8)}</p></div></div><span className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground"><Shield className="h-3 w-3" />{member.role}</span>{canManage && member.role !== "OWNER" && <><select aria-label={`Role for ${member.displayName ?? member.userId}`} className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={member.role} onChange={(event) => void changeRole(member.userId, event.target.value)} disabled={busy === member.userId}><option value="ADMIN">Admin</option><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option></select><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => void remove(member.userId)} disabled={busy === member.userId} aria-label="Remove workspace member">{busy === member.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}</Button></>}{canManage && owner?.userId === currentUserId && member.role !== "OWNER" && <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void transfer(member.userId)} disabled={busy === "transfer"}>Make owner</Button>}</div>)}</div></Surface>

    {canManage && <Surface><div className="border-b border-border/70 px-4 py-3"><h2 className="text-sm font-semibold">Pending invitations</h2><p className="text-xs text-muted-foreground">Invitation links expire after seven days.</p></div><div className="divide-y divide-border/70">{invitations.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No invitations yet.</p>}{invitations.map((invitation) => { const state = invitation.accepted_at ? "Accepted" : invitation.revoked_at ? "Revoked" : new Date(invitation.expires_at) <= new Date() ? "Expired" : "Pending"; return <div key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm">{invitation.email}</p><p className="text-xs text-muted-foreground">{invitation.organization_role} · expires {formatDate(invitation.expires_at)}</p></div><span className="text-[10px] uppercase tracking-wide text-muted-foreground">{state}</span>{state === "Pending" && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void revoke(invitation.id)} disabled={busy === invitation.id}>Revoke</Button>}</div>; })}</div></Surface>}

    <Surface className="border-destructive/30"><div className="flex flex-wrap items-center justify-between gap-4 p-4"><div><h2 className="text-sm font-semibold">Leave workspace</h2><p className="mt-1 text-xs text-muted-foreground">{currentMember?.role === "OWNER" ? "Transfer ownership to another member before leaving." : "This removes your access to every project in this workspace."}</p></div><Button type="button" variant="destructive" size="sm" className="h-8 gap-1.5" disabled={busy === "leave" || currentMember?.role === "OWNER"} onClick={() => void leaveWorkspace()}>{busy === "leave" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}Leave workspace</Button></div></Surface>
  </div>;
}
