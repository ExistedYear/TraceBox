import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260047_phase4_issue_editing.sql", import.meta.url), "utf8");

describe("issue editing migration contract", () => {
  it("keeps RPC-only writes and optimistic conflict checks", () => {
    expect(migration).toContain("create or replace function public.update_issue_fields(p_issue_id uuid, p_updates jsonb)");
    expect(migration).toContain("p_expected_updated_at timestamptz");
    expect(migration).toContain("CONFLICT: Issue changed since it was loaded");
    expect(migration).toContain("reporter_id <> v_user");
    expect(migration).toContain("revoke execute on function public.update_issue_fields");
  });

  it("creates restricted issues with grants and required custom values atomically", () => {
    expect(migration).toContain("create or replace function public.create_issue_complete");
    expect(migration).toContain("v_visibility := upper");
    expect(migration).toContain("insert into public.issue_access");
    expect(migration).toContain("Required custom field is missing");
    expect(migration).toContain("insert into public.issues (");
    expect(migration).toContain("visibility\n  ) values");
  });
});
