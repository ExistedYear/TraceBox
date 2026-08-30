import { describe, expect, it } from "vitest";

import { isMissingAuthSession } from "../src/lib/supabase/auth-errors";
import { loginSchema, signupSchema } from "../src/lib/validation/auth";

describe("loginSchema", () => {
  it("accepts a valid login and trims the email", () => {
    expect(loginSchema.parse({ email: "  user@example.com ", password: "password" })).toEqual({
      email: "user@example.com",
      password: "password",
    });
  });

  it("rejects a malformed email", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "password" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("signupSchema", () => {
  it("accepts a valid signup", () => {
    expect(
      signupSchema.parse({
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        password: "correct-horse-battery-staple",
        confirmPassword: "correct-horse-battery-staple",
      }),
    ).toEqual({
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery-staple",
      confirmPassword: "correct-horse-battery-staple",
    });
  });

  it("rejects a short display name", () => {
    const result = signupSchema.safeParse({ displayName: "A", email: "ada@example.com", password: "correct-horse-battery-staple", confirmPassword: "correct-horse-battery-staple" });
    expect(result.success).toBe(false);
  });

  it("rejects a short password", () => {
    const result = signupSchema.safeParse({ displayName: "Ada Lovelace", email: "ada@example.com", password: "short", confirmPassword: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized display name or password", () => {
    const longName = signupSchema.safeParse({ displayName: "A".repeat(121), email: "ada@example.com", password: "correct-horse-battery-staple", confirmPassword: "correct-horse-battery-staple" });
    expect(longName.success).toBe(false);
    const longPass = signupSchema.safeParse({ displayName: "Ada Lovelace", email: "ada@example.com", password: "p".repeat(73), confirmPassword: "p".repeat(73) });
    expect(longPass.success).toBe(false);
  });

  it("rejects mismatched passwords", () => {
    const result = signupSchema.safeParse({ displayName: "Ada Lovelace", email: "ada@example.com", password: "correct-horse-battery-staple", confirmPassword: "different-password" });
    expect(result.success).toBe(false);
  });
});

describe("isMissingAuthSession", () => {
  it("identifies standard missing session errors", () => {
    expect(isMissingAuthSession({ name: "AuthSessionMissingError", message: "Auth session missing!" })).toBe(true);
    expect(isMissingAuthSession({ message: "Auth session missing!" })).toBe(true);
  });

  it("identifies expired and missing refresh token errors", () => {
    expect(isMissingAuthSession({ code: "refresh_token_not_found", message: "Invalid Refresh Token: Refresh Token Not Found" })).toBe(true);
    expect(isMissingAuthSession({ code: "session_not_found", message: "session not found" })).toBe(true);
    expect(isMissingAuthSession({ code: "bad_jwt", message: "jwt expired" })).toBe(true);
    expect(isMissingAuthSession({ message: "invalid claim: missing sub claim" })).toBe(true);
    expect(isMissingAuthSession({ message: "Token is expired by 120s" })).toBe(true);
  });

  it("returns false for non-session errors or null error", () => {
    expect(isMissingAuthSession(null)).toBe(false);
    expect(isMissingAuthSession(undefined)).toBe(false);
    expect(isMissingAuthSession({ code: "database_error", message: "Connection refused" })).toBe(false);
    expect(isMissingAuthSession({ name: "PostgrestError", message: "relation not found" })).toBe(false);
  });
});

