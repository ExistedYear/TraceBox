const ISSUE_KEY_RE = /[A-Z][A-Z0-9]{1,9}-\d+/gi;
const CLOSING_KEY_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?[\s#]*([A-Z][A-Z0-9]{1,9}-\d+)\b/gi;

export function normalizeGithubRepository(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[^/\s]+\/[^/\s]+$/.test(normalized) ? normalized : null;
}

export function extractIssueKeys(text: string): string[] {
  return [...new Set((text.match(ISSUE_KEY_RE) ?? []).map((key) => key.toUpperCase()))];
}

export function extractClosingIssueKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(CLOSING_KEY_RE)) keys.push(match[1].toUpperCase());
  return [...new Set(keys)];
}
