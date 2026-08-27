"use client";

import { useState } from "react";
import { Loader2, ShieldAlert, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type AccessGrant = { user_id: string; granted_by: string | null };
type Member = { userId: string; label: string };

type Props = {
  issueId: string;
  canEdit: boolean;
  initialVisibility: string;
  initialGrants: AccessGrant[];
  members: Member[];
};

export function IssueSecuritySection({ issueId, canEdit, initialVisibility, initialGrants, members }: Props) {
  const [visibility, setVisibility] = useState(initialVisibility === "RESTRICTED" ? "RESTRICTED" : "PROJECT");
  const [grants, setGrants] = useState(initialGrants);
  const [selectedUser, setSelectedUser] = useState("");
  const [saving, setSaving] = useState(false);

  async function updateVisibility(next: string) {
    setSaving(true);
    try {
      const { error } = await createClient().rpc("set_issue_visibility", { p_issue_id: issueId, p_visibility: next });
      if (error) {
        toast.error("Could not update issue visibility.");
        return;
      }
      setVisibility(next);
      toast.success("Issue visibility updated.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function grantAccess() {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const { error } = await createClient().rpc("grant_issue_access", { p_issue_id: issueId, p_user_id: selectedUser });
      if (error) {
        toast.error("Could not grant issue access.");
        return;
      }
      setGrants((current) => current.some((grant) => grant.user_id === selectedUser) ? current : [...current, { user_id: selectedUser, granted_by: null }]);
      setSelectedUser("");
      toast.success("Issue access granted.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeAccess(userId: string) {
    setSaving(true);
    try {
      const { error } = await createClient().rpc("revoke_issue_access", { p_issue_id: issueId, p_user_id: userId });
      if (error) {
        toast.error("Could not revoke issue access.");
        return;
      }
      setGrants((current) => current.filter((grant) => grant.user_id !== userId));
      toast.success("Issue access revoked.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit && visibility !== "RESTRICTED") return null;
  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4">
      <div className="flex items-center gap-2"><ShieldAlert className="h-3.5 w-3.5 text-amber-400" /><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Security access</h2></div>
      {canEdit && <div className="flex items-center gap-2"><label htmlFor="issue-visibility" className="text-xs text-muted-foreground">Visibility</label><select id="issue-visibility" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={visibility} onChange={(event) => void updateVisibility(event.target.value)} disabled={saving}><option value="PROJECT">Project members</option><option value="RESTRICTED">Restricted access</option></select></div>}
      {visibility === "RESTRICTED" && <div className="space-y-2"><p className="text-[11px] text-muted-foreground">Only maintainers, the reporter, assignee, and listed users can view this issue.</p>{grants.map((grant) => <div key={grant.user_id} className="flex items-center justify-between text-xs"><span>{members.find((member) => member.userId === grant.user_id)?.label ?? grant.user_id.slice(0, 8)}</span>{canEdit && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => void revokeAccess(grant.user_id)} disabled={saving} aria-label="Revoke issue access"><UserMinus className="h-3 w-3" /></Button>}</div>)}{canEdit && <div className="flex gap-2"><select aria-label="Grant access to user" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Select project member...</option>{members.filter((member) => !grants.some((grant) => grant.user_id === member.userId)).map((member) => <option key={member.userId} value={member.userId}>{member.label}</option>)}</select><Button size="sm" className="h-8 gap-1 text-xs" onClick={() => void grantAccess()} disabled={!selectedUser || saving}>{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Grant</Button></div>}</div>}
    </section>
  );
}
