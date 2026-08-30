import "server-only";

import { AI_MAX_CONTEXT_CHARS, AI_MAX_OUTPUT_CHARS, AI_MODEL, AI_TIMEOUT_MS } from "./config";
import { AiError, mapProviderError } from "./errors";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
};

class OpenRouterHttpError extends Error {
  constructor(readonly status: number, details: string) {
    super(`OpenRouter request failed with status ${status}: ${details}`);
    this.name = "OpenRouterHttpError";
  }
}

function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AiError("AI_NOT_CONFIGURED");
  return key;
}

export type OpenRouterJsonOptions = { systemPrompt: string; userPayload: unknown; schemaName: string; jsonSchema: object; maxOutputTokens?: number };

export async function openRouterJson<T>(options: OpenRouterJsonOptions): Promise<T> {
  const payload = JSON.stringify(options.userPayload);
  if (payload.length > AI_MAX_CONTEXT_CHARS || options.systemPrompt.length > AI_MAX_CONTEXT_CHARS) throw new AiError("AI_REQUEST_TOO_LARGE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${getOpenRouterApiKey()}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: payload },
        ],
        max_tokens: Math.min(options.maxOutputTokens ?? 2048, 4096),
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: { name: options.schemaName, strict: true, schema: options.jsonSchema },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new OpenRouterHttpError(response.status, details.slice(0, 500));
    }
    const result = await response.json() as OpenRouterResponse;
    const content = result.choices?.[0]?.message?.content ?? "";
    if (!content || content.length > AI_MAX_OUTPUT_CHARS) throw new AiError("AI_INVALID_RESPONSE");
    try { return JSON.parse(content) as T; } catch { throw new AiError("AI_INVALID_RESPONSE"); }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw mapProviderError(error);
  } finally { clearTimeout(timeout); }
}

export { AI_MODEL };
