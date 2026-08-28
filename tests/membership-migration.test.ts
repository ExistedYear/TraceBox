import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260043_phase2_membership_invitations.sql", import.meta.url), "utf8");

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

  it("audits project membership upserts according to their actual mutation", () => {
    expect(migration).toContain("case when v_old_role is null then 'PROJECT_MEMBER_ADDED' else 'PROJECT_ROLE_CHANGED' end");
    expect(migration).toContain("if v_old_role is not null and v_old_role = p_role then return");
  });
});
