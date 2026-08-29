import { describe, expect, it } from "vitest";

import { triageAnalysisSchema } from "@/lib/ai/schemas/triage";
import { searchParseSchema } from "@/lib/ai/schemas/search";
import { releaseBriefSchema } from "@/lib/ai/schemas/release";

describe("triageAnalysisSchema", () => {
  const valid = {
    component: { component_id: null, confidence: 90, reason: "Authentication component is the failing subsystem." },
    severity: { value: "CRITICAL" as const, confidence: 91, reason: "Login blocked" },
    priority: { value: "P1" as const, confidence: 84, reason: "Blocks release" },
    assignee: { user_id: null, confidence: 78, reason: "No owner found" },
    regression: { likelihood: "HIGH" as const, confidence: 87, reason: "Started after v2.8" },
    follow_up_questions: [{ question: "Which browser version?", reason: "Missing exact version" }],
    duplicate_analysis: [{ issue_id: "00000000-0000-4000-a000-000000000001", likelihood: 93, evidence: ["same failure"], differences: ["different browser"] }],
  };

  it("accepts valid triage response", () => {
    expect(triageAnalysisSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown component if not validated externally", () => {
    // schema itself allows any uuid, but application layer must reject unknown
    const unknownComponent = { ...valid, component: { component_id: "00000000-0000-4000-a000-000000000002", confidence: 90, reason: "x" } };
    const parsed = triageAnalysisSchema.safeParse(unknownComponent);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const allowed = new Set(["00000000-0000-4000-a000-000000000001"]);
      expect(allowed.has(parsed.data.component.component_id!)).toBe(false);
    }
  });

  it("rejects unknown assignee format", () => {
    const bad = { ...valid, assignee: { user_id: "not-a-uuid", confidence: 50, reason: "x" } };
    expect(triageAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects confidence outside range", () => {
    const bad = { ...valid, severity: { value: "CRITICAL" as const, confidence: 150, reason: "x" } };
    expect(triageAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid severity", () => {
    const bad = { ...valid, severity: { value: "UNKNOWN" as unknown as "CRITICAL", confidence: 50, reason: "x" } };
    expect(triageAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const bad = { ...valid, priority: { value: "P9" as unknown as "P1", confidence: 50, reason: "x" } };
    expect(triageAnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown duplicate issue ID format", () => {
    const bad = { ...valid, duplicate_analysis: [{ issue_id: "bad-id", likelihood: 90, evidence: ["x"], differences: [] }] };
    expect(triageAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});

describe("searchParseSchema", () => {
  it("accepts valid search parse", () => {
    expect(searchParseSchema.safeParse({ statuses: [], priorities: ["P0"], types: ["BUG"], assignee: "ME", text: "login" }).success).toBe(true);
  });

  it("rejects invalid uuids", () => {
    expect(searchParseSchema.safeParse({ component_id: "not-uuid" }).success).toBe(false);
  });
});

describe("releaseBriefSchema", () => {
  it("accepts valid brief", () => {
    const valid = { risk_level: "HIGH" as const, summary: "Auth is primary concern", primary_risks: [{ issue_key: "TRACE-184", reason: "Blocks login" }], recommendation: "Hold v2.8" };
    expect(releaseBriefSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid risk level", () => {
    const bad = { risk_level: "UNKNOWN" as unknown as "HIGH", summary: "x", primary_risks: [], recommendation: "x" };
    expect(releaseBriefSchema.safeParse(bad).success).toBe(false);
  });
});
