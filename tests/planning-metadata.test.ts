import { describe, expect, it } from "vitest";

import {
  labelSchema,
  milestoneSchema,
  MILESTONE_STATUSES,
  versionSchema,
} from "../src/lib/validation/planning";

describe("Phase 7: Planning Metadata Schemas", () => {
  describe("labelSchema", () => {
    it("accepts valid label names and hex colors", () => {
      expect(labelSchema.safeParse({ name: "frontend", color: "#6366f1" }).success).toBe(true);
      expect(labelSchema.safeParse({ name: "security", color: "#f43f5e", description: "Vulnerability reports" }).success).toBe(true);
    });

    it("rejects empty names or invalid hex colors", () => {
      expect(labelSchema.safeParse({ name: "", color: "#6366f1" }).success).toBe(false);
      expect(labelSchema.safeParse({ name: "bug", color: "red" }).success).toBe(false);
      expect(labelSchema.safeParse({ name: "bug", color: "#12345" }).success).toBe(false);
    });
  });

  describe("versionSchema", () => {
    it("accepts version names and release statuses", () => {
      expect(versionSchema.safeParse({ name: "v1.0.0", is_released: true }).success).toBe(true);
      expect(versionSchema.safeParse({ name: "2026.1-beta", is_released: false }).success).toBe(true);
    });

    it("rejects empty version names", () => {
      expect(versionSchema.safeParse({ name: "" }).success).toBe(false);
    });
  });

  describe("milestoneSchema", () => {
    it("accepts all milestone statuses", () => {
      for (const status of MILESTONE_STATUSES) {
        expect(milestoneSchema.safeParse({ name: "Sprint 1", status }).success).toBe(true);
      }
    });

    it("rejects unknown statuses or empty names", () => {
      expect(milestoneSchema.safeParse({ name: "Sprint 1", status: "BOGUS" }).success).toBe(false);
      expect(milestoneSchema.safeParse({ name: "" }).success).toBe(false);
    });
  });
});
