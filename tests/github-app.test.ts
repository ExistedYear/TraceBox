import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyGithubApiError, getGithubInstallationForUser, getGithubPullRequestChecks, githubApiRequest, GithubApiError, summarizeGithubChecks, type GithubInstallationResponse } from "@/lib/github-app";

function installation(id: number): GithubInstallationResponse {
  return {
    id,
    account: { id: 105336533, login: "ExistedYear", type: "User" },
    repository_selection: "selected",
    permissions: { metadata: "read" },
    suspended_at: null,
    app_slug: "traceboxclonefest",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitHub App user-installation verification", () => {
  it("finds the callback installation through GitHub's supported list endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ total_count: 1, installations: [installation(157045871)] }), { status: 200 }));

    await expect(getGithubInstallationForUser("user-token", 157045871)).resolves.toMatchObject({ id: 157045871, app_slug: "traceboxclonefest" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/user/installations?per_page=100&page=1");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer user-token");
  });

  it("checks subsequent pages before rejecting an installation", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => installation(index + 1));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, installations: firstPage }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, installations: [installation(157045871)] }), { status: 200 }));

    await expect(getGithubInstallationForUser("user-token", 157045871)).resolves.toMatchObject({ id: 157045871 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects installation ids the authenticated user cannot access", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ total_count: 0, installations: [] }), { status: 200 }));

    const error = await getGithubInstallationForUser("user-token", 157045871).catch((cause) => cause);
    expect(error).toBeInstanceOf(GithubApiError);
    expect(error).toMatchObject({ status: 404, requestPath: "/user/installations" });
  });
});

describe("GitHub API error classification", () => {
  it("distinguishes missing resources from revoked installations", () => {
    expect(classifyGithubApiError(new GithubApiError(404, "not found", "/repos/acme/app/pulls/1"))).toBe("NOT_FOUND");
    expect(classifyGithubApiError(new GithubApiError(404, "not found", "/app/installations/123/access_tokens"))).toBe("AUTH_REVOKED");
  });

  it("preserves rate-limit response metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 403, headers: { "x-github-request-id": "abc", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "123", "retry-after": "30" } }));
    const error = await githubApiRequest("/repos/acme/app", "token").catch((cause) => cause);
    expect(error).toBeInstanceOf(GithubApiError);
    expect(error).toMatchObject({ requestId: "abc", retryAfter: 30, rateLimitRemaining: 0, rateLimitReset: 123, kind: "RATE_LIMITED" });
  });

  it("aggregates mixed check runs into a deterministic summary", () => {
    expect(summarizeGithubChecks({ total_count: 3, check_runs: [
      { id: 1, name: "lint", status: "completed", conclusion: "success", html_url: null },
      { id: 2, name: "tests", status: "completed", conclusion: "success", html_url: null },
      { id: 3, name: "deploy", status: "in_progress", conclusion: null, html_url: null },
    ] })).toMatchObject({ state: "PENDING", totalCount: 3, completedCount: 2, successfulCount: 2, failedCount: 0, pendingCount: 1 });
  });

  it("fetches all check-run pages before returning a summary source", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `check-${index + 1}`, status: "completed", conclusion: "success", html_url: null }));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, check_runs: firstPage }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, check_runs: [{ id: 101, name: "late-failure", status: "completed", conclusion: "failure", html_url: null }] }), { status: 200 }));

    const checks = await getGithubPullRequestChecks("token", "acme", "app", "head-sha");
    expect(checks.check_runs).toHaveLength(101);
    expect(checks.check_runs.at(-1)?.name).toBe("late-failure");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/acme/app/commits/head-sha/check-runs?per_page=100&page=1",
      "https://api.github.com/repos/acme/app/commits/head-sha/check-runs?per_page=100&page=2",
    ]);
  });
});
