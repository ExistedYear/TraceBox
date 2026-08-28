/**
 * Public API scope contract. Keep this list aligned with api_tokens_scopes_check
 * in the latest migration and with every authenticateApiRequest call site.
 */
export const API_SCOPES = [
  "read",
  "write",
  "projects:read",
  "issues:read",
  "issues:write",
  "comments:write",
  "milestones:read",
  "search:read",
  "integrations:read",
  "github_links:read",
  "github_links:write",
] as const;

export type ApiScope = Exclude<(typeof API_SCOPES)[number], "read" | "write">;

export const API_TOKEN_PRESETS = {
  read: ["projects:read", "issues:read", "milestones:read", "search:read", "integrations:read", "github_links:read"],
  contributor: ["projects:read", "issues:read", "issues:write", "comments:write", "milestones:read", "search:read", "integrations:read", "github_links:read", "github_links:write"],
  full: ["projects:read", "issues:read", "issues:write", "comments:write", "milestones:read", "search:read", "integrations:read", "github_links:read", "github_links:write"],
} as const;
