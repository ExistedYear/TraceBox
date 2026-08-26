import { describe, expect, it } from "vitest";

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
      }),
    ).toEqual({
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-battery-staple",
    });
  });

  it("rejects a short display name", () => {
    const result = signupSchema.safeParse({ displayName: "A", email: "ada@example.com", password: "correct-horse-battery-staple" });
    expect(result.success).toBe(false);
  });

  it("rejects a short password", () => {
    const result = signupSchema.safeParse({ displayName: "Ada Lovelace", email: "ada@example.com", password: "short" });
    expect(result.success).toBe(false);
  });
});
