import { describe, expect, it } from "vitest";

import { decodeIssueSearchParams, encodeIssueFilters, eventSummary, formatIssueKey, parseIssueKey } from "../src/lib/issues";
import { issueCreateSchema } from "../src/lib/validation/issue";

describe("formatIssueKey", () => {
  it("renders KEY-N", () => {
    expect(formatIssueKey("auth", 12)).toBe("AUTH-12");
    expect(formatIssueKey("TRACE", 184)).toBe("TRACE-184");
  });
});

describe("parseIssueKey", () => {
  it("parses valid route keys case-insensitively", () => {
    expect(parseIssueKey("auth-12")).toEqual({ projectKey: "AUTH", issueNumber: 12 });
    expect(parseIssueKey("WEB-184")).toEqual({ projectKey: "WEB", issueNumber: 184 });
  });

  it("rejects malformed params", () => {
    for (const bad of ["auth", "auth-x", "-12", "AU TH-1", "", "auth--3"]) {
      expect(parseIssueKey(bad)).toBeNull();
    }
  });
});

describe("eventSummary", () => {
  it("describes creation with the original title", () => {
    const summary = eventSummary({ event_type: "ISSUE_CREATED", metadata: { title: "Login loop", type: "BUG" } });
    expect(summary.heading).toBe("created this issue");
    expect(summary.detail).toBe("Login loop");
  });

  it("formats field transitions without raw JSON", () => {
    const summary = eventSummary({ event_type: "PRIORITY_CHANGED", old_value: "P2", new_value: "P1" });
    expect(summary).toEqual({ heading: "changed priority", detail: "P2 → P1" });
  });
  it("resolves user ids in assignee and component events", () => {
    const resolveId = (id: string) => `Ada (${id.slice(0, 4)})`;
    expect(eventSummary({ event_type: "ASSIGNEE_CHANGED", old_value: "11111111-1111-4111-8111-111111111111", new_value: "22222222-2222-4222-8222-222222222222" }, resolveId)).toEqual({
      heading: "changed assignee",
      detail: "Ada (1111) → Ada (2222)",
    });
    expect(eventSummary({ event_type: "COMPONENT_CHANGED", old_value: "Auth", new_value: "Billing" })).toEqual({
      heading: "changed component",
      detail: "Auth → Billing",
    });
  });
});

describe("issueCreateSchema", () => {
  const base = { title: "Crash on save", description: "Steps included", type: "BUG", component_id: "c1c6bdf0-0000-4000-8000-000000000001" };

  it("accepts a valid issue with required description and component", () => {
    expect(issueCreateSchema.safeParse({ ...base, priority: "P2", severity: "MAJOR" }).success).toBe(true);
  });

  it("requires title, non-empty description and a known type", () => {
    expect(issueCreateSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(issueCreateSchema.safeParse({ ...base, description: "" }).success).toBe(false);
    expect(issueCreateSchema.safeParse({ ...base, type: "NOT_A_TYPE" }).success).toBe(false);
  });

  it("allows filing without a component for fresh projects", () => {
    const { component_id: _omitted, ...withoutComponent } = base;
    expect(issueCreateSchema.safeParse({ ...withoutComponent, priority: "P2", severity: "MAJOR" }).success).toBe(true);
    expect(issueCreateSchema.safeParse({ ...base, component_id: "", priority: "P2", severity: "MAJOR" }).success).toBe(true);
  });

  it("rejects non-uuid component or assignee hints", () => {
    expect(issueCreateSchema.safeParse({ ...base, component_id: "nope" }).success).toBe(false);
    expect(issueCreateSchema.safeParse({ ...base, assignee_id: "nope" }).success).toBe(false);
  });
});

describe("issue filter codecs", () => {
  it("encodes set filters and drops empty values", () => {
    expect(encodeIssueFilters({ priority: "P1", type: "BUG" })).toEqual({ priority: "P1", type: "BUG" });
    expect(encodeIssueFilters({ priority: "", severity: undefined })).toEqual({});
  });

  it("decodes only whitelisted ids and enum-ish values", () => {
    const valid = { stateIds: new Set(["s1"]), componentIds: new Set(["c1"]) };
    expect(decodeIssueSearchParams({ status: "s1", component: "c1", priority: "P0" }, valid)).toEqual({
      statusId: "s1",
      componentId: "c1",
      priority: "P0",
      severity: undefined,
      type: undefined,
    });
    expect(decodeIssueSearchParams({ status: "bogus", component: "nope" }, valid).statusId).toBeUndefined();
    expect(decodeIssueSearchParams({ status: ["s1"] }, valid).statusId).toBeUndefined();
  });
});

describe("decodeIssueSearchParams enum whitelisting", () => {
  const valid = { stateIds: new Set(["s1"]), componentIds: new Set(["c1"]) };

  it("drops priority/severity/type values outside their enums", () => {
    expect(decodeIssueSearchParams({ priority: "P9", severity: "HUGE", type: "NOT_A_TYPE" }, valid)).toEqual({});
    expect(decodeIssueSearchParams({ priority: "P1", severity: "MAJOR", type: "BUG" }, valid)).toEqual({
      priority: "P1",
      severity: "MAJOR",
      type: "BUG",
    });
  });
});
