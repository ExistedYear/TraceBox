import { describe, expect, it } from "vitest";

describe("Phase 10 template contract", () => {
  it("keeps template lifecycle RPCs and atomic label application in the migration", async () => {
    const migration = await import("node:fs/promises").then((fs) => fs.readFile("supabase/migrations/202608260054_phase10_templates.sql", "utf8"));
    expect(migration).toContain("issue_template_labels");
    expect(migration).toContain("set_issue_template_archived");
    expect(migration).toContain("duplicate_issue_template");
    expect(migration).toContain("create_issue_complete_base");
    expect(migration).toContain("not t.is_archived");
    expect(migration).toContain("revoke execute on function public.create_issue_complete_base(uuid, jsonb) from anon, public, authenticated");
    expect(migration).toContain("if not new.is_archived and new.default_component_id is not null");
    expect(migration).toContain("for key share;");
    expect(migration).toContain("Custom field does not belong to this project");
    expect(migration).toContain("Custom values must be an object");
    expect(migration).toContain("create_issue_template_complete");
    expect(migration).toContain("update_issue_template_complete");
  });
});
