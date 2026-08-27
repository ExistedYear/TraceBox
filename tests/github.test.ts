import { describe, expect, it } from "vitest";

import { extractClosingIssueKeys, extractIssueKeys, normalizeGithubRepository } from "@/lib/github";

describe("GitHub integration helpers", () => {
  it("normalizes repository names", () => {
    expect(normalizeGithubRepository(" OpenAI/TraceBox ")).toBe("openai/tracebox");
    expect(normalizeGithubRepository("tracebox")).toBeNull();
  });

  it("extracts issue keys without requiring uppercase input", () => {
    expect(extractIssueKeys("Fix core-12 and CORE-12, see ui-4")).toEqual(["CORE-12", "UI-4"]);
  });

  it("only treats closing-keyword references as auto-resolution candidates", () => {
    expect(extractClosingIssueKeys("Fixes core-12; related to CORE-9. Resolves UI-4")).toEqual(["CORE-12", "UI-4"]);
  });
});
