import { describe, expect, it } from "vitest";

import { loginSchema, signupSchema } from "../src/lib/validation/auth";

describe("loginSchema", () => {
  it("accepts a valid login and trims the email", () => {
    expect(loginSchema.parse({ email: "  user@example.com ", password: "password" })).toEqual({
      email: "user@example.com",
      password: "password",
    });
  });

  it("rejects malformed credentials", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "" });

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

  it("rejects short names and passwords", () => {
    const result = signupSchema.safeParse({ displayName: "A", email: "ada@example.com", password: "short" });

    expect(result.success).toBe(false);
  });
});
