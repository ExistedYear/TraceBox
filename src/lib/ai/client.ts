import "server-only";

import { AI_MAX_CONTEXT_CHARS, AI_MAX_OUTPUT_CHARS, AI_MODEL, AI_TIMEOUT_MS } from "./config";
import { AiError, mapProviderError } from "./errors";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiResponse = {
  promptFeedback?: { blockReason?: unknown };
  candidates?: Array<{
    finishReason?: unknown;
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

class GeminiHttpError extends Error {
  constructor(readonly status: number, readonly details: string) {
    super(`Google AI request failed with status ${status}: ${details}`);
    this.name = "GeminiHttpError";
  }
}

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("AI_NOT_CONFIGURED");
  return key;
}

export type GeminiJsonOptions = { systemPrompt: string; userPayload: unknown; schemaName: string; jsonSchema: object; maxOutputTokens?: number; requestId?: string };

function sanitizeLogText(value: string, maxLength = 500): string {
  return value
    .replace(/AIza[0-9A-Za-z_-]+/g, "[REDACTED_API_KEY]")
    .replace(/sk-[0-9A-Za-z_-]+/g, "[REDACTED_SECRET]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, maxLength);
}

function providerErrorDetails(details: string): { code?: string; status?: string; message: string } {
  try {
    const parsed = JSON.parse(details) as { error?: { code?: unknown; status?: unknown; message?: unknown } };
    const providerError = parsed?.error;
    if (providerError && typeof providerError === "object") {
      return {
        code: typeof providerError.code === "number" || typeof providerError.code === "string" ? String(providerError.code) : undefined,
        status: typeof providerError.status === "string" ? sanitizeLogText(providerError.status, 100) : undefined,
        message: typeof providerError.message === "string" ? sanitizeLogText(providerError.message) : "Provider returned an error without a message",
      };
    }
  } catch {
    // Some gateways return plain text or HTML instead of Google's JSON error envelope.
  }
  return { message: sanitizeLogText(details || "Provider returned an empty error response") };
}

function logGeminiProviderFailure(options: GeminiJsonOptions, error: GeminiHttpError): void {
  const provider = providerErrorDetails(error.details);
  console.error("Trace Intelligence Gemini provider failure", {
    event: "trace_intelligence_gemini_provider_failure",
    operation: options.schemaName,
    model: AI_MODEL,
    requestId: options.requestId,
    httpStatus: error.status,
    providerCode: provider.code,
    providerStatus: provider.status,
    providerMessage: provider.message,
  });
}

function logGeminiResponseFailure(options: GeminiJsonOptions, fields: Record<string, unknown>): void {
  console.error("Trace Intelligence Gemini response failure", {
    event: "trace_intelligence_gemini_response_failure",
    operation: options.schemaName,
    model: AI_MODEL,
    requestId: options.requestId,
    ...fields,
  });
}

export async function geminiJson<T>(options: GeminiJsonOptions): Promise<T> {
  const payload = JSON.stringify(options.userPayload);
  if (payload.length > AI_MAX_CONTEXT_CHARS || options.systemPrompt.length > AI_MAX_CONTEXT_CHARS) throw new AiError("AI_REQUEST_TOO_LARGE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${GEMINI_API_URL}/models/${AI_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": getGeminiApiKey() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: payload }] }],
        generationConfig: {
          maxOutputTokens: Math.min(options.maxOutputTokens ?? 2048, 4096),
          responseFormat: { text: { mimeType: "application/json", schema: options.jsonSchema } },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new GeminiHttpError(response.status, details.slice(0, 500));
    }
    const result = await response.json() as GeminiResponse;
    const content = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!content || content.length > AI_MAX_OUTPUT_CHARS) {
      logGeminiResponseFailure(options, {
        reason: !content ? "missing_text_candidate" : "output_too_large",
        outputChars: content.length,
        candidateCount: result.candidates?.length ?? 0,
        finishReasons: (result.candidates ?? []).map((candidate) => candidate.finishReason).filter((reason) => typeof reason === "string").slice(0, 3),
        blockReason: typeof result.promptFeedback?.blockReason === "string" ? result.promptFeedback.blockReason : undefined,
      });
      throw new AiError("AI_INVALID_RESPONSE");
    }
    try {
      return JSON.parse(content) as T;
    } catch {
      logGeminiResponseFailure(options, { reason: "invalid_json", outputChars: content.length });
      throw new AiError("AI_INVALID_RESPONSE");
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof GeminiHttpError) logGeminiProviderFailure(options, error);
    else console.error("Trace Intelligence Gemini request failure", {
      event: "trace_intelligence_gemini_request_failure",
      operation: options.schemaName,
      model: AI_MODEL,
      requestId: options.requestId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? sanitizeLogText(error.message, 300) : "Unknown request failure",
    });
    throw mapProviderError(error);
  } finally { clearTimeout(timeout); }
}

export { AI_MODEL };
