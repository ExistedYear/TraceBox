import { describe, expect, it } from "vitest";

import { getSafeWorkspaceErrorMessage } from "../src/lib/errors";
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

describe("getSafeWorkspaceErrorMessage", () => {
  it("maps duplicate workspace slug errors", () => {
    expect(getSafeWorkspaceErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "organizations_slug_key"' })).toBe(
      "That workspace URL is already taken. Try another slug.",
    );
  });

  it("maps duplicate project key errors", () => {
    expect(getSafeWorkspaceErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "projects_organization_id_key_key"' })).toBe(
      "A project with that key already exists in this workspace.",
    );
  });

  it("maps NOT_ORG_ADMIN errors clearly", () => {
    expect(getSafeWorkspaceErrorMessage({ message: "NOT_ORG_ADMIN" })).toBe(
      "Only workspace owners and admins can create projects.",
    );
    expect(getSafeWorkspaceErrorMessage({ message: "P0001: NOT_ORG_ADMIN" })).toBe(
      "Only workspace owners and admins can create projects.",
    );
  });

  it("maps AUTH_REQUIRED errors", () => {
    expect(getSafeWorkspaceErrorMessage({ message: "AUTH_REQUIRED" })).toBe(
      "You must be signed in to perform this action.",
    );
  });

  it("maps check constraint validation errors", () => {
    expect(getSafeWorkspaceErrorMessage({ code: "22023", message: "VALIDATION: invalid key" })).toBe(
      "Project key must be 2–10 uppercase letters or numbers (e.g. AUTH, CORE).",
    );
  });

  it("falls back safely for unknown errors", () => {
    expect(getSafeWorkspaceErrorMessage({ message: "internal network timeout" })).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
