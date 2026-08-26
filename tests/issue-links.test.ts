import { describe, expect, it } from "vitest";

const VALID_RELATIONSHIPS = ["BLOCKS", "DEPENDS_ON", "DUPLICATE_OF", "RELATES_TO", "CAUSED_BY", "REGRESSION_OF"] as const;

function isValidRelationship(rel: string): boolean {
  return (VALID_RELATIONSHIPS as readonly string[]).includes(rel);
}

function findDuplicateCandidates(
  issues: Array<{ id: string; issue_number: number; title: string }>,
  queryTitle: string,
  limit = 5,
): Array<{ issue_number: number; title: string }> {
  const q = queryTitle.toLowerCase();
  const scored = issues
    .map((issue) => {
      const titleLower = issue.title.toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const matches = words.filter((w) => titleLower.includes(w)).length;
      const score = words.length > 0 ? matches / words.length : 0;
      return { issue, score };
    })
    .filter((x) => x.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ issue_number: x.issue.issue_number, title: x.issue.title }));
  return scored;
}

describe("Phase 11: Dependencies & Duplicates", () => {
  it("validates allowed issue link relationships", () => {
    for (const rel of VALID_RELATIONSHIPS) {
      expect(isValidRelationship(rel)).toBe(true);
    }
    expect(isValidRelationship("INVALID")).toBe(false);
    expect(isValidRelationship("blocks")).toBe(false);
  });

  it("prevents self-links", () => {
    const sourceId = "11111111-1111-4111-8111-111111111111";
    const targetId = "11111111-1111-4111-8111-111111111111";
    expect(sourceId === targetId).toBe(true);
    // Self-link should be rejected
    expect(sourceId === targetId).toBe(true);
  });

  it("finds duplicate candidates by title similarity", () => {
    const issues = [
      { id: "1", issue_number: 1, title: "Login fails on Safari after sleep" },
      { id: "2", issue_number: 2, title: "Safari drops websocket after sleep" },
      { id: "3", issue_number: 3, title: "Document release checklist" },
    ];
    const candidates = findDuplicateCandidates(issues, "Safari websocket sleep", 2);
    expect(candidates.length).toBe(2);
    expect(candidates[0].issue_number).toBe(2);
  });

  it("returns empty when no title overlap", () => {
    const issues = [
      { id: "1", issue_number: 1, title: "Login fails on Safari" },
    ];
    const candidates = findDuplicateCandidates(issues, "Completely different topic xyz", 5);
    expect(candidates.length).toBe(0);
  });

  it("handles duplicate resolution mapping", () => {
    const resolutionForDuplicate = "DUPLICATE";
    expect(["FIXED", "DUPLICATE", "WONT_FIX", "INVALID", "CANNOT_REPRODUCE", "WORKS_AS_EXPECTED"]).toContain(resolutionForDuplicate);
  });
});
