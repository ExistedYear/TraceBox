import { describe, expect, it } from "vitest";

import { slugify } from "../src/lib/utils";
import { projectSchema, workspaceSchema } from "../src/lib/validation/workspace";

describe("slugify", () => {
  it("derives lowercase dashed slugs from names", () => {
    expect(slugify("Acme Engineering")).toBe("acme-engineering");
    expect(slugify("  Platform Team  ")).toBe("platform-team");
  });

  it("strips accents and collapses separators", () => {
    expect(slugify("Crème & Brûlée")).toBe("creme-brulee");
    expect(slugify("A -- B!!")).toBe("a-b");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("--edge case--")).toBe("edge-case");
  });

  it("keeps digit-only slugs", () => {
    expect(slugify("42")).toBe("42");
  });
});

describe("workspaceSchema", () => {
  it("accepts a valid workspace", () => {
    const result = workspaceSchema.safeParse({ name: "Acme Engineering", slug: "acme-engineering" });
    expect(result.success).toBe(true);
  });
  it("normalizes case but rejects malformed shapes", () => {
    const result = workspaceSchema.safeParse({ name: "Acme", slug: "Acme" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slug).toBe("acme");

    for (const slug of ["-leading", "trailing-", "double--dash", "with space", "a", ""]) {
      expect(workspaceSchema.safeParse({ name: "Acme", slug }).success).toBe(false);
    }
  });

  it("enforces length bounds", () => {
    expect(workspaceSchema.safeParse({ name: "A", slug: "ok-slug" }).success).toBe(false);
    expect(workspaceSchema.safeParse({ name: "Ok name", slug: "s" }).success).toBe(false);
  });
});

describe("projectSchema", () => {
  it("normalizes keys to uppercase", () => {
    const result = projectSchema.safeParse({ name: "Authentication Service", key: "auth" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.key).toBe("AUTH");
  });

  it("rejects keys that do not start with a letter or contain symbols", () => {
    expect(projectSchema.safeParse({ name: "Service", key: "1AUTH" }).success).toBe(false);
    expect(projectSchema.safeParse({ name: "Service", key: "AU-TH" }).success).toBe(false);
  });

  it("allows an optional description within bounds", () => {
    expect(projectSchema.safeParse({ name: "Service", key: "AUTH", description: "" }).success).toBe(true);
    expect(projectSchema.safeParse({ name: "Service", key: "AUTH", description: "x".repeat(281) }).success).toBe(false);
  });
});
