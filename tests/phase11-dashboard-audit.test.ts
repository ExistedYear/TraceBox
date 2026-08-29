import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { decodeIssueSearchParams, encodeIssueFilters } from "@/lib/issues";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("Phase 11 dashboard and audit explorer", () => {
  it("keeps operational dashboard cards linked to canonical queue filters", () => {
    const dashboard = read("src/components/tracebox/dashboard-overview.tsx");
    const issues = read("src/components/issues/issue-table.tsx");
    expect(dashboard).toContain("assignee=${encodeURIComponent(userId)}&unresolved=1");
    expect(dashboard).toContain("overdue=1&unresolved=1");
    expect(issues).toContain("filters.unresolved");
    expect(issues).toContain("filters.overdue");

    const filters = decodeIssueSearchParams({ unresolved: "1", overdue: "1" }, { stateIds: new Set(), componentIds: new Set() });
    expect(encodeIssueFilters(filters)).toEqual({ unresolved: "1", overdue: "1" });
  });

  it("uses one authoritative restricted-safe metric aggregate", () => {
    const migration = read("supabase/migrations/202608260060_phase11_dashboard_metrics.sql");
    expect(migration).toContain("public.can_view_issue(i.id)");
    expect(migration).toContain("ws.category not in ('RESOLVED', 'CLOSED')");
    expect(migration).toContain("revoke execute on function public.get_dashboard_metrics");
  });

  it("exposes exact audit filters while redacting cross-issue JSON references", () => {
    const migration = read("supabase/migrations/202608260061_phase11_audit_explorer.sql");
    const component = read("src/components/audit/audit-explorer.tsx");
    expect(migration).toContain("p_from timestamptz");
    expect(migration).toContain("p_to timestamptz");
    expect(migration).toContain("public.can_view_issue(i.id)");
    expect(migration).toContain("public.redact_audit_json");
    expect(migration).toContain("revoke execute on function public.list_project_audit_events");
    expect(component).toContain('type="date"');
    expect(component).toContain("tracebox-audit.csv");
    expect(component).toContain("UUID_PATTERN");
  });
});
