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
  merged?: boolean;
  merged_at: string | null;
  user?: { login: string } | null;
  body?: string | null;
  head?: { sha: string; ref?: string };
  base?: { ref: string };
  merge_commit_sha?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type GithubCheckRunsResponse = {
  total_count: number;
  check_runs: Array<{ id: number; name: string; status: string; conclusion: string | null; html_url: string | null; completed_at?: string | null; started_at?: string | null }>;
};

export type GithubPullRequestListResponse = GithubPullRequestResponse[];

export type GithubCheckSummary = {
  state: "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | "NONE" | "UNKNOWN";
  totalCount: number;
  completedCount: number;
  successfulCount: number;
  failedCount: number;
  pendingCount: number;
  checks: Array<{ id: number; name: string; status: string; conclusion: string | null; html_url: string | null }>;
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
  requestId: string | null;
  retryAfter: number | null;
  rateLimitRemaining: number | null;
  rateLimitReset: number | null;
  kind: GithubApiErrorKind;

  constructor(status: number, responseMessage: string, requestPath: string | null = null, details: Partial<Pick<GithubApiError, "requestId" | "retryAfter" | "rateLimitRemaining" | "rateLimitReset">> = {}) {
    super(`GitHub API request failed with status ${status}${requestPath ? ` for ${requestPath}` : ""}.`);
    this.name = "GithubApiError";
    this.status = status;
    this.responseMessage = responseMessage;
    this.requestPath = requestPath;
    this.requestId = details.requestId ?? null;
    this.retryAfter = details.retryAfter ?? null;
    this.rateLimitRemaining = details.rateLimitRemaining ?? null;
    this.rateLimitReset = details.rateLimitReset ?? null;
    this.kind = classifyGithubApiError(this);
  }
}

export type GithubApiErrorKind = "AUTH_REVOKED" | "PERMISSION_MISSING" | "RATE_LIMITED" | "SECONDARY_RATE_LIMITED" | "NOT_FOUND" | "TEMPORARY" | "UNKNOWN";

export function classifyGithubApiError(error: Pick<GithubApiError, "status" | "responseMessage" | "requestPath" | "retryAfter" | "rateLimitRemaining">): GithubApiErrorKind {
  const message = error.responseMessage.toLowerCase();
  if (error.status === 401) return "AUTH_REVOKED";
  if (error.status === 404) return error.requestPath?.includes("/app/installations/") ? "AUTH_REVOKED" : "NOT_FOUND";
  if (error.status === 403 && /(abuse|secondary rate|retry later|too many requests)/i.test(message)) return "SECONDARY_RATE_LIMITED";
  if (error.status === 429 || (error.status === 403 && (error.rateLimitRemaining === 0 || error.retryAfter !== null))) return "RATE_LIMITED";
  if (error.status === 403) return "PERMISSION_MISSING";
  if (error.status === 408 || error.status === 409 || error.status === 425 || error.status >= 500) return "TEMPORARY";
  return "UNKNOWN";
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
    const numberHeader = (name: string) => {
      const value = response.headers.get(name);
      const parsed = value ? Number(value) : NaN;
      return Number.isFinite(parsed) ? parsed : null;
    };
    throw new GithubApiError(response.status, message, path, {
      requestId: response.headers.get("x-github-request-id"),
      retryAfter: numberHeader("retry-after"),
      rateLimitRemaining: numberHeader("x-ratelimit-remaining"),
      rateLimitReset: numberHeader("x-ratelimit-reset"),
    });
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

const installationTokenCache = new Map<number, { token: { token: string; expires_at: string; permissions: Record<string, string>; repositories?: GithubRepositoryResponse[] }; expiresAt: number }>();

export function invalidateGithubInstallationToken(installationId: number) {
  installationTokenCache.delete(installationId);
}

export async function createGithubInstallationToken(installationId: number) {
  const cached = installationTokenCache.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
  const response = await githubApiRequest<{ token: string; expires_at: string; permissions: Record<string, string>; repositories?: GithubRepositoryResponse[] }>(
    `/app/installations/${installationId}/access_tokens`,
    createGithubAppJwt(),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
  );
  installationTokenCache.set(installationId, { token: response, expiresAt: new Date(response.expires_at).getTime() });
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

export async function listGithubPullRequests(installationToken: string | null, owner: string, repository: string, options: { state?: "open" | "closed" | "all"; page?: number; perPage?: number }) {
  const query = new URLSearchParams({ state: options.state ?? "open", sort: "updated", direction: "desc", per_page: String(Math.min(options.perPage ?? 30, 100)), page: String(Math.max(options.page ?? 1, 1)) });
  return githubApiRequest<GithubPullRequestListResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?${query.toString()}`, installationToken);
}

export async function getGithubPullRequestChecks(installationToken: string | null, owner: string, repository: string, ref: string) {
  const checkRuns: GithubCheckRunsResponse["check_runs"] = [];
  let totalCount = 0;
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubApiRequest<GithubCheckRunsResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100&page=${page}`,
      installationToken,
    );
    totalCount = response.total_count;
    checkRuns.push(...response.check_runs);
    if (checkRuns.length >= totalCount || response.check_runs.length < 100) break;
  }
  return { total_count: totalCount, check_runs: checkRuns };
}

export function summarizeGithubChecks(response: GithubCheckRunsResponse): GithubCheckSummary {
  const checks = response.check_runs ?? [];
  const pending = checks.filter((check) => check.status !== "completed");
  const failed = checks.filter((check) => check.status === "completed" && ["failure", "timed_out", "action_required", "cancelled", "startup_failure"].includes(check.conclusion ?? ""));
  const successful = checks.filter((check) => check.status === "completed" && ["success", "neutral", "skipped"].includes(check.conclusion ?? ""));
  const completedCount = checks.length - pending.length;
  const state = checks.length === 0 ? "NONE" : failed.length > 0 ? "FAILURE" : pending.length > 0 ? "PENDING" : successful.length === checks.length ? "SUCCESS" : "NEUTRAL";
  return { state, totalCount: checks.length, completedCount, successfulCount: successful.length, failedCount: failed.length, pendingCount: pending.length, checks: checks.map(({ id, name, status, conclusion, html_url }) => ({ id, name, status, conclusion, html_url })) };
}

export async function getGithubCommit(installationToken: string | null, owner: string, repository: string, sha: string) {
  return githubApiRequest<GithubCommitResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(sha)}`, installationToken);
}

export async function getGithubBranch(installationToken: string | null, owner: string, repository: string, branch: string) {
  return githubApiRequest<GithubBranchResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, installationToken);
}
