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
});
