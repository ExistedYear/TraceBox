import { describe, expect, it } from "vitest";

import { getSafeAuthErrorMessage, getSafeWorkspaceErrorMessage } from "../src/lib/errors";
import { getSafeRedirectPath } from "../src/lib/utils";
describe("getSafeRedirectPath", () => {
  it("allows internal paths", () => {
    expect(getSafeRedirectPath("/dashboard?tab=activity")).toBe("/dashboard?tab=activity");
  });

  it("falls back for external or malformed paths", () => {
    expect(getSafeRedirectPath("https://example.com")).toBe("/dashboard");
    expect(getSafeRedirectPath("//example.com")).toBe("/dashboard");
    expect(getSafeRedirectPath("/\\example.com")).toBe("/dashboard");
    expect(getSafeRedirectPath(null)).toBe("/dashboard");
  });
});

describe("getSafeAuthErrorMessage", () => {
  it("returns safe user-facing messages for known auth errors", () => {
    expect(getSafeAuthErrorMessage("Invalid login credentials")).toBe("The email or password is incorrect.");
    expect(getSafeAuthErrorMessage("Email not confirmed")).toBe("Please confirm your email address before signing in.");
  });

  it("does not expose unknown provider errors", () => {
    expect(getSafeAuthErrorMessage("database connection details")).toBe("Something went wrong. Please try again.");
  });
});

describe("getSafeRedirectPath control characters", () => {
  it("rejects control-char smuggled scheme-relative redirects", () => {
    expect(getSafeRedirectPath("/\n//evil.com")).toBe("/dashboard");
    expect(getSafeRedirectPath("/\t//evil.com")).toBe("/dashboard");
  });
});

describe("getSafeWorkspaceErrorMessage", () => {
  it("maps duplicate slug and duplicate project key constraints", () => {
    expect(getSafeWorkspaceErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "organizations_slug_key"' })).toBe(
      "That workspace URL is already taken. Try another slug.",
    );
    expect(getSafeWorkspaceErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "projects_organization_id_key_key"' })).toBe(
      "A project with that key already exists in this workspace.",
    );
  });

  it("maps the NOT_ORG_ADMIN rpc failure and falls back generically", () => {
    expect(getSafeWorkspaceErrorMessage({ message: "NOT_ORG_ADMIN" })).toBe("Only workspace owners and admins can create projects.");
    expect(getSafeWorkspaceErrorMessage({})).toBe("Something went wrong. Please try again.");
  });
});
