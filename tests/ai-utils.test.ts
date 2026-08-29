import { describe, expect, it } from "vitest";

import { canonicalHash, canonicalStringify } from "@/lib/ai/hash";
import { redactObject, redactText } from "@/lib/ai/redact";
import { AiError, mapProviderError } from "@/lib/ai/errors";
import { AI_MODEL } from "@/lib/ai/config";

describe("canonicalStringify", () => {
  it("is stable for equivalent input with different key ordering", () => {
    const a = canonicalStringify({ b: 2, a: 1, c: { z: 3, y: 2 } });
    const b = canonicalStringify({ a: 1, c: { y: 2, z: 3 }, b: 2 });
    expect(a).toBe(b);
  });

  it("produces different output for meaningful changes", () => {
    const a = canonicalStringify({ issue: { title: "hello" }, model: AI_MODEL });
    const b = canonicalStringify({ issue: { title: "hello world" }, model: AI_MODEL });
    expect(a).not.toBe(b);
    const hashA = canonicalHash({ title: "hello" }, AI_MODEL);
    const hashB = canonicalHash({ title: "hello world" }, AI_MODEL);
    expect(hashA).not.toBe(hashB);
  });

  it("hash includes model identifier", () => {
    const hashA = canonicalHash({ foo: "bar" }, "model-a");
    const hashB = canonicalHash({ foo: "bar" }, "model-b");
    expect(hashA).not.toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("redact", () => {
  it("redacts bearer token", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactText(input)).not.toContain("eyJhbGci");
    expect(redactText(input)).toContain("[REDACTED]");
  });

  it("redacts JWT-like token", () => {
    const jwt = "aaa.bbb.ccc";
    const redacted = redactText(`token is ${jwt} here`);
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts password assignment", () => {
    expect(redactText("password=supersecret123")).toContain("[REDACTED]");
    expect(redactText("api_key: 'sk-1234567890abcdef'")).toContain("[REDACTED]");
    expect(redactText("client_secret=abcdef123456")).toContain("[REDACTED]");
  });

  it("redacts API key assignment", () => {
    expect(redactText("api_key=AKIAIOSFODNN7EXAMPLE")).toContain("[REDACTED]");
    expect(redactText("token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).toContain("[REDACTED]");
  });

  it("redacts object values deeply", () => {
    const obj = { headers: { Authorization: "Bearer token123", cookie: "secret" }, nested: { password: "hunter2" } };
    const redacted = redactObject(obj) as typeof obj;
    expect(redacted.headers.Authorization).toBe("[REDACTED]");
    expect(redacted.nested.password).not.toBe("hunter2");
  });
});

describe("AiError mapping", () => {
  it("maps timeout correctly", () => {
    const err = mapProviderError(new Error("Request timed out after 8000ms"));
    expect(err.code).toBe("AI_TIMEOUT");
    expect(err.status).toBe(504);
  });

  it("maps 429 correctly", () => {
    const err = mapProviderError(new Error("429 Too Many Requests"));
    expect(err.code).toBe("AI_RATE_LIMITED");
    expect(err.status).toBe(429);
  });

  it("maps invalid response correctly", () => {
    const err = mapProviderError(new Error("Invalid response json"));
    expect(err instanceof AiError).toBe(true);
  });

  it("creates AiError with code", () => {
    const err = new AiError("AI_NOT_CONFIGURED", "missing key", 503);
    expect(err.code).toBe("AI_NOT_CONFIGURED");
    expect(err.status).toBe(503);
  });
});
