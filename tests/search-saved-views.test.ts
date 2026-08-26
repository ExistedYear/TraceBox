import { describe, expect, it } from "vitest";

import { decodeSavedViewFilters, encodeSavedViewFilters, matchesSearch } from "../src/lib/validation/saved-views";
import { savedViewSchema } from "../src/lib/validation/saved-views";

describe("Phase 10: Search & Saved Views", () => {
  it("validates saved view schema", () => {
    expect(savedViewSchema.safeParse({ name: "My View" }).success).toBe(true);
    expect(savedViewSchema.safeParse({ name: "" }).success).toBe(false);
    expect(savedViewSchema.safeParse({ name: "a".repeat(81) }).success).toBe(false);
  });

  it("encodes and decodes saved view filters", () => {
    const filters = { status: "open", priority: "P1" };
    const encoded = encodeSavedViewFilters(filters);
    expect(encoded).toBe("status=open&priority=P1");
    const decoded = decodeSavedViewFilters(encoded);
    expect(decoded).toEqual(filters);
  });

  it("matches search query against title, description, and key", () => {
    const issue = { title: "Login fails on Safari", description: "WebSocket drops after sleep", keyLabel: "AUTH-42" };
    expect(matchesSearch(issue, "safari")).toBe(true);
    expect(matchesSearch(issue, "websocket")).toBe(true);
    expect(matchesSearch(issue, "AUTH-42")).toBe(true);
    expect(matchesSearch(issue, "nonexistent")).toBe(false);
    expect(matchesSearch(issue, "")).toBe(true);
  });
});
