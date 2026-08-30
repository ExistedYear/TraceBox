const REDACTED = "[REDACTED]";
const patterns = [
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, /(?:gh[oprs]|ghu|github_pat)_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g, /-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g,
  /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /(password|passwd|secret|api[_-]?key|apikey|token|client_secret)\s*[:=]\s*['"]?[^'"\s]+['"]?/gi,
];
export function redactText(input: string): string { return patterns.reduce((value, pattern) => value.replace(pattern, REDACTED), input); }
export function redactObject<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => redactObject(entry)) as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = /^(authorization|cookie|token|secret|password|passwd|api[_-]?key|client_secret)$/i.test(key) ? REDACTED : redactObject(entry);
    }
    return result as T;
  }
  return value;
}
