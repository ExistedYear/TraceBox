import { describe, expect, it } from "vitest";

import { componentSchema } from "../src/lib/validation/components";

describe("componentSchema", () => {
  it("accepts a valid component", () => {
    const result = componentSchema.safeParse({ name: "Authentication", description: "", default_assignee_id: "" });
    expect(result.success).toBe(true);
  });

  it("requires a non-empty name within bounds", () => {
    expect(componentSchema.safeParse({ name: "" }).success).toBe(false);
    expect(componentSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("bounds the description", () => {
    expect(componentSchema.safeParse({ name: "Auth", description: "x".repeat(281) }).success).toBe(false);
    expect(componentSchema.safeParse({ name: "Auth", description: "Login flows" }).success).toBe(true);
  });

  it("validates default_assignee_id as uuid or empty", () => {
    expect(componentSchema.safeParse({ name: "Auth", default_assignee_id: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
    expect(componentSchema.safeParse({ name: "Auth", default_assignee_id: "" }).success).toBe(true);
    expect(componentSchema.safeParse({ name: "Auth", default_assignee_id: "not-a-uuid" }).success).toBe(false);
  });
});
