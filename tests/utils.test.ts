import { describe, expect, it } from "vitest";

import { getSafeAuthErrorMessage } from "../src/lib/errors";
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
