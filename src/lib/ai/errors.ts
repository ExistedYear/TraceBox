export const AI_ERROR_CODES = [
  "AI_NOT_CONFIGURED",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_PROVIDER_ERROR",
  "AI_INVALID_RESPONSE",
  "AI_DISABLED_FOR_RESTRICTED_ISSUE",
  "AI_CONTEXT_UNAVAILABLE",
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  code: AiErrorCode;
  status: number;

  constructor(code: AiErrorCode, message?: string, status = 500) {
    super(message ?? code);
    this.name = "AiError";
    this.code = code;
    this.status = status;
  }
}

export function mapProviderError(error: unknown): AiError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("rate limit")) {
    return new AiError("AI_RATE_LIMITED", "Trace AI is rate limited. Try again shortly.", 429);
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("abort")) {
    return new AiError("AI_TIMEOUT", "Trace AI timed out.", 504);
  }
  if (lower.includes("invalid") && lower.includes("response")) {
    return new AiError("AI_INVALID_RESPONSE", "Trace AI returned an invalid response.", 502);
  }
  return new AiError("AI_PROVIDER_ERROR", "Trace AI is temporarily unavailable.", 502);
}

export function userFacingMessage(code: AiErrorCode): string {
  switch (code) {
    case "AI_NOT_CONFIGURED":
      return "Trace AI is not configured.";
    case "AI_RATE_LIMITED":
      return "Trace AI is rate limited. Try again shortly.";
    case "AI_TIMEOUT":
      return "Trace AI timed out. Deterministic analysis is still available.";
    case "AI_PROVIDER_ERROR":
      return "Trace AI is temporarily unavailable. Deterministic analysis is still available.";
    case "AI_INVALID_RESPONSE":
      return "Trace AI returned an unexpected response. Deterministic analysis is still available.";
    case "AI_DISABLED_FOR_RESTRICTED_ISSUE":
      return "Trace AI is disabled for restricted issues to prevent external disclosure. Deterministic report-quality and duplicate-search tools remain available where permitted.";
    case "AI_CONTEXT_UNAVAILABLE":
      return "Trace AI context is unavailable.";
    default:
      return "Trace AI is temporarily unavailable.";
  }
}
