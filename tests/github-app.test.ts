import { afterEach, describe, expect, it, vi } from "vitest";

import { getGithubInstallationForUser, GithubApiError, type GithubInstallationResponse } from "@/lib/github-app";

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
