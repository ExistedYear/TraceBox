import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeIssueSearchParams } from "../src/lib/issues";

const migration = readFileSync(new URL("../supabase/migrations/202608260055_phase10_custom_fields.sql", import.meta.url), "utf8");

describe("Phase 10 custom fields", () => {
  it("provides a complete maintainer lifecycle and immutable type safety", () => {
    expect(migration).toContain("function public.update_custom_field");
    expect(migration).toContain("function public.bulk_set_issue_custom_value");
    expect(migration).toContain("Cannot change field type after values exist");
    expect(migration).toContain("validate_issue_custom_value");
    expect(migration).toContain("create trigger validate_custom_field_definition");
    expect(migration).toContain("Select fields require unique non-empty options");
    expect(migration).toContain("om.role in ('OWNER', 'ADMIN')");
    expect(migration).toContain("Existing values use an option that would be removed");
  });

  it("keeps direct writes locked down and validates clears", () => {
    expect(migration).toContain("create trigger validate_issue_custom_value");
    expect(migration).toContain("p_value = '\"\"'::jsonb or p_value = '[]'::jsonb");
    expect(migration).toContain("revoke execute on function public.set_issue_custom_value");
    expect(migration).toContain("CUSTOM_FIELD_UPDATED");
    expect(migration).toContain("Duplicate issue IDs are not allowed");
    expect(migration).toContain("update public.issues set updated_at = now()");
  });

  it("rejects unknown custom-field ids and oversized URL values", () => {
    const valid = decodeIssueSearchParams({ custom_field: "bad-id", custom_value: "x" }, { stateIds: new Set(), componentIds: new Set(), customFieldIds: new Set(["123e4567-e89b-12d3-a456-426614174000"]) });
    expect(valid.customFieldId).toBeUndefined();
    const oversized = decodeIssueSearchParams({ custom_field: "123e4567-e89b-12d3-a456-426614174000", custom_value: "x".repeat(201) }, { stateIds: new Set(), componentIds: new Set(), customFieldIds: new Set(["123e4567-e89b-12d3-a456-426614174000"]) });
    expect(oversized.customFieldValue).toBeUndefined();
  });
});
