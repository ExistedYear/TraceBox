import "server-only";

import { AI_MAX_CONTEXT_CHARS, AI_MAX_OUTPUT_CHARS, AI_MODEL, AI_TIMEOUT_MS } from "./config";
import { AiError, mapProviderError } from "./errors";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

class GeminiHttpError extends Error {
  constructor(readonly status: number, details: string) {
    super(`Google AI request failed with status ${status}: ${details}`);
    this.name = "GeminiHttpError";
  }
}

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("AI_NOT_CONFIGURED");
  return key;
}

export type GeminiJsonOptions = { systemPrompt: string; userPayload: unknown; schemaName: string; jsonSchema: object; maxOutputTokens?: number };

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
    if (!content || content.length > AI_MAX_OUTPUT_CHARS) throw new AiError("AI_INVALID_RESPONSE");
    try { return JSON.parse(content) as T; } catch { throw new AiError("AI_INVALID_RESPONSE"); }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw mapProviderError(error);
  } finally { clearTimeout(timeout); }
}

export { AI_MODEL };
