import { describe, expect, it } from "vitest";

import { getSafeAuthErrorMessage } from "@/lib/errors";

describe("getSafeAuthErrorMessage", () => {
  it.each([
    ["invalid_credentials", "The email or password is incorrect."],
    ["email_not_confirmed", "Please confirm your email address before signing in."],
    ["user_already_exists", "An account with this email already exists."],
    ["email_exists", "An account with this email already exists."],
    ["weak_password", "Choose a password with at least 8 characters."],
    ["over_email_send_rate_limit", "Too many emails were requested. Wait a few minutes and try again."],
    ["email_address_invalid", "Enter a valid email address."],
    ["email_address_not_authorized", "Email delivery is unavailable. Ask the administrator to configure custom SMTP in Supabase."],
    ["email_provider_disabled", "Email delivery is unavailable. Ask the administrator to configure custom SMTP in Supabase."],
  ])("maps Supabase Auth code %s", (code, expected) => {
    expect(getSafeAuthErrorMessage({ code, message: "provider detail that must not leak" })).toBe(expected);
  });

  it("does not expose an unknown provider message", () => {
    expect(getSafeAuthErrorMessage({ code: "unexpected_failure", message: "sensitive internal detail" })).toBe("Something went wrong. Please try again.");
  });

  it("keeps compatibility with known legacy messages", () => {
    expect(getSafeAuthErrorMessage("Invalid login credentials")).toBe("The email or password is incorrect.");
  });
});
