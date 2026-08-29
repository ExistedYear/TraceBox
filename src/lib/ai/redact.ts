const REDACTED = "[REDACTED]";

const REDACT_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi, replacement: `Bearer ${REDACTED}` },
  { re: /gh[oprs]_[A-Za-z0-9_]{20,}/g, replacement: REDACTED },
  { re: /ghu_[A-Za-z0-9_]{20,}/g, replacement: REDACTED },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: REDACTED },
  { re: /AKIA[0-9A-Z]{16}/g, replacement: REDACTED },
  { re: /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, replacement: REDACTED },
  { re: /[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, replacement: REDACTED },
  { re: /(password|passwd|secret|api[_-]?key|apikey|token|client_secret)\s*[:=]\s*['"]?[^'"\s]+['"]?/gi, replacement: `$1=${REDACTED}` },
  { re: /Authorization\s*:\s*Bearer\s+[^\s]+/gi, replacement: `Authorization: Bearer ${REDACTED}` },
];

export function redactText(input: string): string {
  let output = input;
  for (const { re, replacement } of REDACT_PATTERNS) {
    output = output.replace(re, replacement);
  }
  return output;
}

export function redactObject<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value) as unknown as T;
  if (Array.isArray(value)) return (value as unknown[]).map((entry) => redactObject(entry)) as unknown as T;
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (["authorization", "cookie", "x-api-key", "apikey", "token", "secret", "password", "passwd", "client_secret"].includes(lower)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactObject(entry);
      }
    }
    return result as T;
  }
  return value;
}
