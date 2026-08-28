import { describe, expect, it } from "vitest";

import { createGithubConnectState, verifyGithubConnectState } from "@/lib/github-connect-state";
import { extractClosingIssueKeys, extractIssueKeys, githubBranchMatches, normalizeGithubRepository } from "@/lib/github";

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

  it("supports GitHub's multi-issue closing syntax", () => {
    expect(extractClosingIssueKeys("Fixes CORE-12, CORE-13 and UI-4; refs CORE-9")).toEqual(["CORE-12", "CORE-13", "UI-4"]);
  });

  it("matches configured target branch patterns", () => {
    expect(githubBranchMatches("main", ["main", "release/*"])).toBe(true);
    expect(githubBranchMatches("release/2026.08", ["main", "release/*"])).toBe(true);
    expect(githubBranchMatches("develop", ["main", "release/*"])).toBe(false);
  });

  it("binds installation state to the TraceBox user, workspace, and project", () => {
    const previousSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    process.env.GITHUB_APP_CLIENT_SECRET = "test-client-secret";
    const created = createGithubConnectState({ userId: "user-1", organizationId: "org-1", projectId: "project-1" });
    expect(verifyGithubConnectState(created.cookieValue, created.state)).toMatchObject({ userId: "user-1", organizationId: "org-1", projectId: "project-1" });
    expect(verifyGithubConnectState(created.cookieValue, "wrong-state")).toBeNull();
    if (previousSecret === undefined) delete process.env.GITHUB_APP_CLIENT_SECRET;
    else process.env.GITHUB_APP_CLIENT_SECRET = previousSecret;
  });
});
