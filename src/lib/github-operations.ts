export const MAX_GITHUB_WEBHOOK_ATTEMPTS = 8;
// Keep webhook ingestion bounded before JSON parsing and persistence. GitHub
// push payloads can be sizeable, so use a 5 MiB ceiling while still protecting
// the unauthenticated endpoint from unbounded request bodies.
export const MAX_GITHUB_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;

export type GithubInstallationHealth = "HEALTHY" | "ACTION_REQUIRED" | "PENDING_APPROVAL" | "REVOKED" | "SUSPENDED" | "PERMISSION_UPDATE_REQUIRED" | "NOT_CONNECTED";
export type GithubFailureCategory = "AUTHORIZATION" | "RATE_LIMITED" | "REPOSITORY_ACCESS" | "RETRY_BUDGET_EXHAUSTED" | "UPSTREAM" | "PROCESSING";

export type GithubOperationInstallation = {
  id: string;
  github_installation_id: number;
  github_account_login: string;
  github_account_type: string;
  status: string;
  permissions: Record<string, unknown>;
  last_verified_at: string | null;
};

export type GithubOperationRepository = {
  id: string;
  installation_id: string;
  github_repository_id: number;
  full_name: string;
  private: boolean;
  archived: boolean;
  default_branch: string | null;
  html_url: string;
  is_accessible: boolean;
  last_synced_at: string | null;
  is_primary: boolean;
  target_branches: string[];
  auto_resolve_enabled: boolean;
};

export type GithubOperationDelivery = {
  delivery_id: string;
  event_name: string;
  action: string | null;
  github_installation_id: number | null;
  github_repository_id: number | null;
  status: string;
  attempt_count: number;
  error: string | null;
  received_at: string;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  processed_at: string | null;
  failure_category?: GithubFailureCategory | string | null;
  retry_eligible?: boolean;
  affected_issues?: Array<{ issue_key: string; relationship: string; resolution_applied: boolean }>;
};

export function expectedGithubPermissions(permissions: Record<string, unknown> | null | undefined) {
  const required = ["contents", "metadata", "pull_requests", "checks"];
  return required.filter((permission) => {
    const value = permissions?.[permission];
    return typeof value !== "string" || !["read", "write"].includes(value.toLowerCase());
  });
}

export function deriveGithubInstallationHealth(input: {
  installations: Array<Pick<GithubOperationInstallation, "status" | "permissions">>;
  inaccessibleRepositoryCount?: number;
  hasRecentFailures?: boolean;
}): GithubInstallationHealth {
  if (input.installations.length === 0) return "NOT_CONNECTED";
  const active = input.installations.find((installation) => installation.status === "ACTIVE");
  if (!active) {
    if (input.installations.some((installation) => installation.status === "PENDING")) return "PENDING_APPROVAL";
    if (input.installations.some((installation) => installation.status === "SUSPENDED")) return "SUSPENDED";
    if (input.installations.some((installation) => installation.status === "REVOKED")) return "REVOKED";
    return "ACTION_REQUIRED";
  }
  if (expectedGithubPermissions(active.permissions).length > 0) return "PERMISSION_UPDATE_REQUIRED";
  if ((input.inaccessibleRepositoryCount ?? 0) > 0 || input.hasRecentFailures) return "ACTION_REQUIRED";
  return "HEALTHY";
}

export function githubFailureCategory(error: string | null, attemptCount = 0): GithubFailureCategory {
  if (attemptCount >= MAX_GITHUB_WEBHOOK_ATTEMPTS || /maximum retry|retry budget/i.test(error ?? "")) return "RETRY_BUDGET_EXHAUSTED";
  if (/rate.?limit|too many requests|secondary rate/i.test(error ?? "")) return "RATE_LIMITED";
  if (/permission|forbidden|unauthori[sz]|revok|token/i.test(error ?? "")) return "AUTHORIZATION";
  if (/repository|access|not found/i.test(error ?? "")) return "REPOSITORY_ACCESS";
  if (/timeout|network|upstream|github/i.test(error ?? "")) return "UPSTREAM";
  return "PROCESSING";
}

export function isGithubDeliveryRetryEligible(delivery: Pick<GithubOperationDelivery, "status" | "attempt_count" | "next_retry_at">, now = Date.now()) {
  if (delivery.status !== "FAILED" || delivery.attempt_count >= MAX_GITHUB_WEBHOOK_ATTEMPTS) return false;
  return !delivery.next_retry_at || Date.parse(delivery.next_retry_at) <= now;
}

export function statusLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (character) => character.toUpperCase());
}
