import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260053_phase9_triage_command_ux.sql", import.meta.url), "utf8");
const triage = readFileSync(new URL("../src/components/triage/triage-inbox.tsx", import.meta.url), "utf8");
const palette = readFileSync(new URL("../src/components/layout/app-header.tsx", import.meta.url), "utf8");

describe("Phase 9 triage and command contracts", () => {
  it("resolves duplicates atomically with visibility and deterministic locks", () => {
    expect(migration).toContain("function public.resolve_duplicate_issue");
    expect(migration).toContain("order by i.id for update");
    expect(migration).toContain("public.can_view_issue(p_duplicate_issue_id)");
    expect(migration).toContain("insert into public.issue_links");
    expect(migration).toContain("resolution = 'DUPLICATE'");
    expect(migration).toContain("closed_at = null");
    expect(migration).toContain("'STATUS_CHANGED'");
    expect(migration).toContain("'RESOLUTION_CHANGED'");
    expect(migration).toContain("'canonical_issue_id'");
    expect(migration).toContain("revoke execute on function public.resolve_duplicate_issue");
  });

  it("keeps triage shortcuts guarded and uses the atomic RPC", () => {
    expect(triage).toContain("resolve_duplicate_issue");
    expect(triage).toContain("Open ${canonicalKey}");
    expect(triage).toContain("target?.closest(\"input, textarea, select, button, a, [role='button']\")");
    for (const key of ["key === \"p\"", "key === \"s\"", "key === \"c\"", "key === \"e\"", "key === \"u\""]) expect(triage).toContain(key);
  });

  it("exposes command palette destinations", () => {
    expect(palette).toContain("My issues");
    expect(palette).toContain("Open notifications");
    expect(palette).toContain("File new issue");
    expect(palette).toContain("Open ${project.name}");
  });
});
