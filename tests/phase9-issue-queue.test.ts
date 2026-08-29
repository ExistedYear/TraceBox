import { describe, expect, it } from "vitest";

import { decodeIssueSearchParams, encodeIssueFilters } from "../src/lib/issues";

describe("Phase 9 issue queue codecs", () => {
  const valid = {
    stateIds: new Set(["state-1"]),
    componentIds: new Set(["component-1"]),
    memberIds: new Set(["member-1"]),
    versionIds: new Set(["version-1"]),
    milestoneIds: new Set(["milestone-1"]),
    labelIds: new Set(["label-1"]),
  };

  it("round-trips planning, ownership, resolution, and date filters", () => {
    const filters = {
      reporterId: "member-1",
      resolution: "FIXED" as const,
      versionId: "version-1",
      milestoneId: "milestone-1",
      labelId: "label-1",
      createdFrom: "2026-08-01",
      createdTo: "2026-08-31",
      updatedFrom: "2026-08-10",
      updatedTo: "2026-08-29",
    };
    expect(decodeIssueSearchParams(encodeIssueFilters(filters), valid)).toEqual(filters);
  });

  it("drops untrusted ids, resolutions, and malformed dates", () => {
    expect(decodeIssueSearchParams({ reporter: "other", version: "other", resolution: "ADMIN", created_from: "yesterday" }, valid)).toEqual({});
    expect(decodeIssueSearchParams({ created_from: "2026-02-30", created_to: "2026-08-01" }, valid)).toEqual({ createdTo: "2026-08-01" });
    expect(decodeIssueSearchParams({ updated_from: "2026-08-20", updated_to: "2026-08-01" }, valid)).toEqual({});
  });
});
