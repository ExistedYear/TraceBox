import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { encodeSavedViewLink, isSavedViewId, savedViewSchema } from "../src/lib/validation/saved-views";

const migration = readFileSync(new URL("../supabase/migrations/202608260052_phase9_saved_views.sql", import.meta.url), "utf8");

describe("Phase 9 saved views", () => {
  it("uses explicit visibility and removes the boolean sharing contract", () => {
    expect(migration).toContain("visibility in ('PRIVATE', 'PROJECT', 'ORGANIZATION')");
    expect(migration).toContain("alter table public.saved_views drop column if exists is_shared");
    expect(migration).toContain("Authorized members can read saved views");
    expect(savedViewSchema.safeParse({ name: "My view", visibility: "ORGANIZATION" }).success).toBe(true);
    expect(savedViewSchema.safeParse({ name: "My view", visibility: "INVALID" }).success).toBe(false);
  });

  it("exposes the complete RPC lifecycle and locks direct writes", () => {
    for (const fn of ["create_saved_view", "rename_saved_view", "update_saved_view_filters", "update_saved_view_visibility", "delete_saved_view"]) {
      expect(migration).toContain(`function public.${fn}`);
    }
    expect(migration).toContain("revoke execute on function public.create_saved_view");
    expect(migration).toContain("using (\n    public.is_project_member(project_id)");
    expect(migration).toContain("if v_visibility = 'ORGANIZATION' and not public.can_manage_project");
    expect(migration).not.toMatch(/on public\.saved_views for (insert|update|delete)/i);
    expect(migration).toContain("public.is_project_member(sv.project_id)");
    expect(migration).toContain("delete from public.saved_views sv");
    expect(migration).toContain("if not found then raise exception 'NOT_FOUND'");
    expect(migration).toContain("updated_at = now()");
  });

  it("generates stable view URLs and validates IDs", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(encodeSavedViewLink(id)).toBe(`?view=${id}`);
    expect(isSavedViewId(id)).toBe(true);
    expect(isSavedViewId("not-a-view")).toBe(false);
  });
});
