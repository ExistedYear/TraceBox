import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { calculateReportQuality } from "@/features/intelligence/report-quality";
import { getBlastRadius } from "@/features/intelligence/blast-radius";
import { buildTriageContext } from "@/features/intelligence/triage-context";
import { sanitizeSearchFilters } from "@/features/intelligence/search-filters";
import { canonicalHash } from "@/lib/ai/hash";
import { AI_MODEL } from "@/lib/ai/config";
import { mapProviderError } from "@/lib/ai/errors";
import { isUuid, sameOrigin } from "@/lib/ai/http";
import { redactObject } from "@/lib/ai/redact";

const id = "00000000-0000-4000-a000-000000000001";
const allow = { statuses: new Set([id]), components: new Set([id]), members: new Set([id]), versions: new Set([id]), milestones: new Set([id]), labels: new Set([id]), customFields: new Set([id]) };

describe("Trace Intelligence server/domain boundaries", () => {
  it("scores eligible reports locally, including restricted reports", () => {
    const issue = { type: "TASK", description: "A meaningful report that should not be scored by this feature." };
    expect(calculateReportQuality(issue).eligible).toBe(false);
    expect(calculateReportQuality({ ...issue, type: "BUG", visibility: "RESTRICTED" }).score).toBeGreaterThan(0);
    expect(calculateReportQuality({ ...issue, type: "BUG", visibility: "RESTRICTED" }).isRestricted).toBe(true);
    expect(calculateReportQuality({ ...issue, type: "BUG" }).score).toBeGreaterThan(0);
  });

  it("includes bounded defect evidence only after recursive redaction", () => {
    const context = redactObject(buildTriageContext({ issue: { id, issue_number: 1, project_id: id, title: "Login fails", description: "password=secret", type: "BUG", priority: "P2", severity: "MAJOR", status_id: id, component_id: null, affected_version_id: null, target_milestone_id: null, steps_to_reproduce: "1. Open login\n2. Submit form", expected_behavior: null, actual_behavior: null, environment: null }, components: [], assignees: [], duplicateCandidates: [] }));
    expect(JSON.stringify(context)).not.toContain("password=secret");
    expect(JSON.stringify(context)).toContain("Open login");
  });

  it("filters model IDs against project allowlists and supports full date/flag contract", () => {
    const result = sanitizeSearchFilters({ statuses: [id], resolutions: [], priorities: ["P1"], severities: [], types: ["BUG"], assignee: "ME", reporter: null, component_id: id, affected_version_id: null, target_milestone_id: null, labels: [], text: " login ", status_categories: ["OPEN"], visibility: "PROJECT", created_from: "2026-01-01", created_to: "2026-01-31", updated_from: null, updated_to: null, custom_field_id: id, custom_value: "true", unresolved: true, overdue: false, critical: false }, allow);
    expect(result.statuses).toEqual([id]);
    expect(result.assignee).toBe("ME");
    expect(result.created_from).toBe("2026-01-01");
    expect(result.unresolved).toBe(true);
  });

  it("hash includes model and schema/prompt versioning", () => {
    expect(canonicalHash({ a: 1 }, AI_MODEL)).not.toBe(canonicalHash({ a: 1 }, "other-model"));
  });

  it("sanitizes provider failures without exposing provider text", () => {
    const error = mapProviderError(new Error("OpenRouter secret=very-private 429 internal response"));
    expect(error.code).toBe("AI_RATE_LIMITED");
    expect(error.message).not.toContain("very-private");
    expect(error.message).not.toContain("OpenRouter");
  });

  it("rejects cross-origin and originless scripted writes", () => {
    expect(sameOrigin(new NextRequest("https://trace-box.vercel.app/api/intelligence/search", { method: "POST", headers: { origin: "https://trace-box.vercel.app" } }))).toBe(true);
    expect(sameOrigin(new NextRequest("https://trace-box.vercel.app/api/intelligence/search", { method: "POST", headers: { origin: "https://attacker.test" } }))).toBe(false);
    expect(sameOrigin(new NextRequest("https://trace-box.vercel.app/api/intelligence/search", { method: "POST" }))).toBe(false);
    expect(sameOrigin(new NextRequest("https://trace-box.vercel.app/api/intelligence/search", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }))).toBe(true);
  });

  it("validates identifiers and keeps blast-radius traversal bounded and directional", () => {
    expect(isUuid(id)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    const second = "00000000-0000-4000-a000-000000000002";
    const third = "00000000-0000-4000-a000-000000000003";
    const graph = getBlastRadius(id, [
      { id: "l1", source_issue_id: id, target_issue_id: second, relationship: "BLOCKS" },
      { id: "l2", source_issue_id: third, target_issue_id: second, relationship: "DEPENDS_ON" },
      { id: "l3", source_issue_id: second, target_issue_id: id, relationship: "RELATES_TO" },
    ], new Map(), new Set([id, second, third]), 5, 20);
    expect(graph.nodes.map((node) => node.id)).toEqual([id, second, third]);
    expect(graph.directBlocked).toBe(1);
    expect(graph.transitiveBlocked).toBe(2);
  });
});
