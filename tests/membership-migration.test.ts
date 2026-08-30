import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260045_membership_invitations.sql", import.meta.url), "utf8");
const relationalGuards = readFileSync(new URL("../supabase/migrations/202608260046_phase2_membership_relational_guards.sql", import.meta.url), "utf8");
const workspaceLeave = readFileSync(new URL("../supabase/migrations/202608260085_workspace_self_leave.sql", import.meta.url), "utf8");
const workspaceMembersUi = readFileSync(new URL("../src/components/settings/workspace-members-manager.tsx", import.meta.url), "utf8");

describe("membership migration contract", () => {
  it("keeps invitation secrets hashed and time-bound", () => {
    expect(migration).toContain("digest(v_token, 'sha256')");
    expect(migration).toContain("expires_at <= timezone('utc'::text, now())");
    expect(migration).toContain("INVITATION_WRONG_ACCOUNT");
  });

  it("exposes only RPC-backed membership mutations", () => {
    expect(migration).toContain("revoke insert, update, delete on public.organization_members");
    expect(migration).toContain("revoke insert, update, delete on public.project_members");
    for (const functionName of ["create_organization_invitation", "accept_organization_invitation", "add_project_member", "update_organization_member_role", "update_project_member_role", "remove_project_member", "remove_organization_member", "transfer_organization_ownership"]) {
      expect(migration).toContain(`function public.${functionName}`);
    }
    expect(migration).toContain("workspace_invitations_one_pending_idx");
    expect(migration).toContain("list_project_invitations");
  });

  it("protects ownership and invalidates restricted access on removal", () => {
    expect(migration).toContain("LAST_OWNER");
    expect(migration).toContain("OWNER_TRANSFER_REQUIRED");
    expect(migration).toContain("delete from public.issue_access");
    expect(migration).toContain("delete from public.issue_watchers");
    expect(migration).toContain("delete from public.notifications");
    expect(migration).toContain("delete from public.api_tokens");
    expect(migration).toContain("create or replace function public.is_project_member");
    expect(migration).toContain('drop policy if exists "Org members can read their projects"');
    expect(migration).toContain("if not found or not public.is_project_member(v_issue.project_id) then return false");
    expect(migration).toContain("public.list_project_invitations");
    expect(migration).toContain("where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.role = 'MAINTAINER'");
    expect(migration).toContain("membership_events_immutable");
  });

  it("keeps security-definer membership functions behind authenticated RPC grants", () => {
    expect(migration).toContain("if v_actor is null then raise exception 'AUTH_REQUIRED'");
    expect(migration).toContain("revoke execute on function public.create_organization_invitation");
    expect(migration).toContain("grant execute on function public.create_organization_invitation");
    expect(migration).toContain("to authenticated;");
    expect(migration).toContain("create policy \"Organization admins can read invitations\"");
    expect(migration).toContain("create policy \"Organization members can read membership history\"");
  });

  it("audits project membership upserts according to their actual mutation", () => {
    expect(migration).toContain("case when v_old_role is null then 'PROJECT_MEMBER_ADDED' else 'PROJECT_ROLE_CHANGED' end");
    expect(migration).toContain("if v_old_role is not null and v_old_role = p_role then return");
  });

  it("prevents cross-workspace project references at the table boundary", () => {
    expect(relationalGuards).toContain("enforce_membership_project_organization");
    expect(relationalGuards).toContain("p.organization_id = new.organization_id");
    expect(relationalGuards).toContain("membership_events_project_organization_guard");
    expect(relationalGuards).toContain("workspace_invitations_project_organization_guard");
    expect(relationalGuards).toContain("revoke execute on function public.enforce_membership_project_organization()");
  });

  it("allows only the current non-owner to leave and cleans up workspace access", () => {
    expect(workspaceLeave).toContain("function public.leave_organization");
    expect(workspaceLeave).toContain("v_user uuid := auth.uid()");
    expect(workspaceLeave).toContain("OWNER_TRANSFER_REQUIRED");
    expect(workspaceLeave).toContain("delete from public.project_members");
    expect(workspaceLeave).toContain("delete from public.api_tokens");
    expect(workspaceLeave).toContain("'source', 'self_service'");
    expect(workspaceLeave).toContain("revoke execute on function public.leave_organization(uuid) from public, anon");
    expect(workspaceLeave).toContain("grant execute on function public.leave_organization(uuid) to authenticated");
    expect(workspaceMembersUi).toContain("Leave workspace");
    expect(workspaceMembersUi).toContain('currentMember?.role === "OWNER"');
    expect(workspaceMembersUi).toContain('document.cookie = "tb_org=; path=/; max-age=0; samesite=lax"');
  });
});
