export const AI_ERROR_CODES = [
  "AI_NOT_CONFIGURED", "AI_RATE_LIMITED", "AI_TIMEOUT", "AI_PROVIDER_ERROR",
  "AI_INVALID_RESPONSE", "AI_DISABLED_FOR_RESTRICTED_ISSUE", "AI_CONTEXT_UNAVAILABLE",
  "AI_REQUEST_TOO_LARGE", "AI_NOT_AUTHORIZED", "AI_CLAIM_CONFLICT",
  "AI_STALE_ISSUE",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  constructor(code: AiErrorCode, message = userFacingMessage(code), status = statusFor(code)) {
    super(message); this.name = "AiError"; this.code = code; this.status = status;
  }
}

function statusFor(code: AiErrorCode): number {
  if (code === "AI_NOT_CONFIGURED") return 503;
  if (code === "AI_RATE_LIMITED") return 429;
  if (code === "AI_TIMEOUT") return 504;
  if (code === "AI_INVALID_RESPONSE" || code === "AI_PROVIDER_ERROR") return 502;
  if (code === "AI_REQUEST_TOO_LARGE") return 413;
  if (code === "AI_NOT_AUTHORIZED" || code === "AI_DISABLED_FOR_RESTRICTED_ISSUE") return 403;
  if (code === "AI_CLAIM_CONFLICT" || code === "AI_STALE_ISSUE") return 409;
  return 400;
}

export function userFacingMessage(code: AiErrorCode): string {
  switch (code) {
    case "AI_NOT_CONFIGURED": return "Trace Intelligence is not configured.";
    case "AI_RATE_LIMITED": return "Trace Intelligence is rate limited. Try again shortly.";
    case "AI_TIMEOUT": return "Trace Intelligence timed out. Try again shortly.";
    case "AI_INVALID_RESPONSE": return "Trace Intelligence returned an unexpected response.";
    case "AI_DISABLED_FOR_RESTRICTED_ISSUE": return "Trace Intelligence is disabled for restricted or security issues.";
    case "AI_CONTEXT_UNAVAILABLE": return "Trace Intelligence context is unavailable.";
    case "AI_REQUEST_TOO_LARGE": return "The Trace Intelligence request is too large.";
    case "AI_NOT_AUTHORIZED": return "You are not authorized for this Trace Intelligence action.";
    case "AI_CLAIM_CONFLICT": return "This Trace Intelligence analysis is already being generated.";
    case "AI_STALE_ISSUE": return "This issue changed while you reviewed the suggestions. Reload and try again.";
    default: return "Trace Intelligence is temporarily unavailable.";
  }
}

/** Convert arbitrary provider failures to a stable public error without provider text. */
export function mapProviderError(error: unknown): AiError {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const lower = `${name} ${message}`.toLowerCase();
  if (lower.includes("429") || lower.includes("rate limit")) return new AiError("AI_RATE_LIMITED");
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out")) return new AiError("AI_TIMEOUT");
  if (lower.includes("json") || lower.includes("schema") || lower.includes("invalid response")) return new AiError("AI_INVALID_RESPONSE");
  return new AiError("AI_PROVIDER_ERROR");
}
