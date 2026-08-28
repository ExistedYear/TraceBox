import { createSign } from "node:crypto";

export type GithubInstallationResponse = {
  id: number;
  account: { id: number; login: string; type: string };
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  suspended_at: string | null;
  app_slug?: string;
};

export type GithubRepositoryResponse = {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string | null;
  html_url: string;
};

export type GithubPullRequestResponse = {
  id: number;
  node_id?: string;
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean | null;
  merged_at: string | null;
  user?: { login: string } | null;
  head?: { sha: string };
  base?: { ref: string };
  created_at: string;
  updated_at: string;
};

export type GithubCheckRunsResponse = {
  total_count: number;
  check_runs: Array<{ id: number; name: string; status: string; conclusion: string | null; html_url: string | null }>;
};

export type GithubCommitResponse = {
  sha: string;
  html_url: string;
  commit?: { message?: string; author?: { name?: string; date?: string } | null };
  author?: { login?: string } | null;
};

export type GithubBranchResponse = { ref: string; object?: { sha: string } };

export class GithubApiError extends Error {
  status: number;
  responseMessage: string;
  requestPath: string | null;

  constructor(status: number, responseMessage: string, requestPath: string | null = null) {
    super(`GitHub API request failed with status ${status}${requestPath ? ` for ${requestPath}` : ""}.`);
    this.name = "GithubApiError";
    this.status = status;
    this.responseMessage = responseMessage;
    this.requestPath = requestPath;
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

export function githubApiVersion() {
  return process.env.GITHUB_API_VERSION ?? "2022-11-28";
}

export function getGithubAppSlug() {
  return requiredEnv("GITHUB_APP_SLUG");
}

export function getGithubAppClientId() {
  return requiredEnv("GITHUB_APP_CLIENT_ID");
}

export function getGithubAppClientSecret() {
  return requiredEnv("GITHUB_APP_CLIENT_SECRET");
}

export function createGithubAppJwt() {
  const appId = requiredEnv("GITHUB_APP_ID");
  const privateKey = requiredEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + jwtLifetimeSeconds(), iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

function jwtLifetimeSeconds() {
  return 9 * 60;
}

export async function githubApiRequest<T>(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", githubApiVersion());
  headers.set("User-Agent", "TraceBox-GitHub-App");
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(10000) });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    throw new GithubApiError(response.status, message, path);
  }
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export async function exchangeGithubUserCode(code: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: getGithubAppClientId(), client_secret: getGithubAppClientSecret(), code, ...(process.env.GITHUB_APP_CALLBACK_URL ? { redirect_uri: process.env.GITHUB_APP_CALLBACK_URL } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !data.access_token) throw new GithubApiError(response.status, data.error ?? "GitHub authorization failed.");
  return data.access_token;
}

export async function getGithubInstallationForUser(userToken: string, installationId: number) {
  let seen = 0;
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubApiRequest<{ total_count: number; installations: GithubInstallationResponse[] }>(
      `/user/installations?per_page=100&page=${page}`,
      userToken,
    );
    const installation = response.installations.find((candidate) => candidate.id === installationId);
    if (installation) return installation;
    seen += response.installations.length;
    if (seen >= response.total_count || response.installations.length < 100) break;
  }
  throw new GithubApiError(404, "Installation is not accessible to the authenticated user.", "/user/installations");
}

export async function createGithubInstallationToken(installationId: number) {
  const response = await githubApiRequest<{ token: string; expires_at: string; permissions: Record<string, string>; repositories?: GithubRepositoryResponse[] }>(
    `/app/installations/${installationId}/access_tokens`,
    createGithubAppJwt(),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
  );
  return response;
}

export async function listGithubInstallationRepositories(installationToken: string) {
  const repositories: GithubRepositoryResponse[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubApiRequest<{ total_count: number; repositories: GithubRepositoryResponse[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
      installationToken,
    );
    repositories.push(...response.repositories);
    if (repositories.length >= response.total_count || response.repositories.length < 100) break;
  }
  return repositories;
}

export async function getGithubRepository(installationToken: string | null, owner: string, repository: string) {
  return githubApiRequest<GithubRepositoryResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, installationToken);
}

export async function getGithubPullRequest(installationToken: string | null, owner: string, repository: string, number: number) {
  return githubApiRequest<GithubPullRequestResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${number}`, installationToken);
}

export async function getGithubPullRequestChecks(installationToken: string | null, owner: string, repository: string, ref: string) {
  return githubApiRequest<GithubCheckRunsResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(ref)}/check-runs`, installationToken);
}

export async function getGithubCommit(installationToken: string | null, owner: string, repository: string, sha: string) {
  return githubApiRequest<GithubCommitResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(sha)}`, installationToken);
}

export async function getGithubBranch(installationToken: string | null, owner: string, repository: string, branch: string) {
  return githubApiRequest<GithubBranchResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, installationToken);
}
