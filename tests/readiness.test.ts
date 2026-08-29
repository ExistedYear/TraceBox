import { describe, expect, it } from "vitest";

import { normalizeReadinessAnalysis, readinessCsv, readinessRiskGroups, type ReadinessAnalysis } from "@/lib/readiness";

const issue = (overrides: Partial<ReadinessAnalysis["issues"][number]> = {}) => ({
  id: crypto.randomUUID(), issueNumber: 1, keyLabel: "TRACE-1", title: "Issue", type: "BUG",
  priority: "P2", severity: "MAJOR", statusCategory: "OPEN", statusName: "Open",
  assigneeId: "user-1", assigneeLabel: "Assigned", componentName: null,
  targetMilestoneId: null, affectedVersionId: null, dueAt: null, ...overrides,
});

describe("release readiness helpers", () => {
  it("normalizes empty or malformed RPC data as no release data", () => {
    expect(normalizeReadinessAnalysis(null, "trace")).toMatchObject({ status: "NO_DATA", score: 0, total: 0, issues: [] });
  });

  it("groups visible open issues across every readiness factor", () => {
    const analysis: ReadinessAnalysis = {
      total: 3, resolvedCount: 0, openCount: 3, blockerCount: 1, criticalCount: 0,
      regressionCount: 1, unassignedCount: 1, unresolvedSecurityCount: 1,
      overdueMilestoneCount: 1, score: 0, status: "BLOCKED",
      issues: [
        issue({ id: "blocker", priority: "P0" }),
        issue({ id: "security", type: "SECURITY", assigneeId: null, assigneeLabel: "Unassigned", dueAt: "2020-01-01T00:00:00Z" }),
        issue({ id: "regression", type: "REGRESSION" }),
      ],
    };
    const groups = readinessRiskGroups(analysis, Date.parse("2021-01-01T00:00:00Z"));
    expect(groups.blockers.map((row) => row.id)).toEqual(["blocker"]);
    expect(groups.security.map((row) => row.id)).toEqual(["security"]);
    expect(groups.overdue.map((row) => row.id)).toEqual(["security"]);
    expect(groups.riskCount).toBe(3);
  });

  it("escapes CSV cells before exporting drilldowns", () => {
    const analysis = normalizeReadinessAnalysis({
      total: 1, resolved_count: 0, open_count: 1, score: 20, status: "BLOCKED",
      issues: [{ id: "issue-1", issueNumber: 1, title: 'Bad, "input"', statusCategory: "OPEN" }],
    }, "trace");
    expect(readinessCsv(analysis)).toContain('"Bad, ""input"""');
  });
});
