const ISSUE_KEY_RE = /[A-Z][A-Z0-9]{1,9}-\d+/gi;
const CLOSING_DIRECTIVE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#?[A-Z][A-Z0-9]{1,9}-\d+(?:(?:\s*,\s*|\s+and\s+|\s+&)#?[A-Z][A-Z0-9]{1,9}-\d+)*/gi;

export function normalizeGithubRepository(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[^/\s]+\/[^/\s]+$/.test(normalized) ? normalized : null;
}

export function extractIssueKeys(text: string): string[] {
  return [...new Set((text.match(ISSUE_KEY_RE) ?? []).map((key) => key.toUpperCase()))];
}

export function extractClosingIssueKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(CLOSING_DIRECTIVE_RE)) keys.push(...extractIssueKeys(match[0]));
  return [...new Set(keys)];
}

export function githubBranchMatches(branch: string, patterns: string[]) {
  return patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`).test(branch);
  });
}
