import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260050_phase8_restricted_completion.sql", import.meta.url), "utf8");

describe("Phase 8 restricted issue completion contract", () => {
  it("audits initial, granted, revoked, and visibility access changes", () => {
    expect(migration).toContain("create or replace function public.record_issue_access_event()");
    expect(migration).toContain("after insert on public.issue_access");
    expect(migration).toContain("after delete on public.issue_access");
    expect(migration).toContain("'ACCESS_GRANTED'");
    expect(migration).toContain("'ACCESS_REVOKED'");
    expect(migration).toContain("delete from public.issue_access where issue_id = p_issue_id");
  });

  it("keeps direct access and audit writes unavailable to browser roles", () => {
    expect(migration).toContain("revoke insert, update, delete on public.issue_access from public, anon, authenticated");
    expect(migration).toContain("grant select on public.issue_access to authenticated");
    expect(migration).toContain("revoke insert, update, delete on public.issue_events from public, anon, authenticated");
    expect(migration).toContain("revoke execute on function public.grant_issue_access(uuid, uuid)");
  });

  it("hardens Storage paths and notification metadata", () => {
    expect(migration).toContain("issue_id_from_storage_path");
    expect(migration).toContain("bucket_id = 'issue-attachments'");
    expect(migration).toContain("name ~ '^[0-9a-f]");
    expect(migration).toContain("safe_issue_number");
    expect(migration).toContain("safe_project_key");
    expect(migration).toContain("safe_issue_title");
    expect(migration).toContain("i.issue_number as safe_issue_number");
    expect(migration).toContain("p.key as safe_project_key");
    expect(migration).toContain("n.issue_id is null or public.can_view_issue(n.issue_id)");
    expect(migration).toContain("then null else i.title end as safe_issue_title");
    expect(migration).toContain("jsonb_build_object('restricted', true)");
  });

  it("preserves generic not-found behavior and authority checks", () => {
    expect(migration).toContain("if not public.can_view_issue(p_issue_id) then raise exception 'NOT_ALLOWED'");
    expect(migration).toContain("if not found then raise exception 'NOT_FOUND'");
    expect(migration).toContain("Grantee must have project access");
    expect(migration).toContain("v_actor <> v_issue.reporter_id");
  });
});
