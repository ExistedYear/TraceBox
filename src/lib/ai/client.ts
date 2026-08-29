import "server-only";

import Groq from "groq-sdk";

import { AI_MODEL, AI_TIMEOUT_MS } from "./config";
import { AiError } from "./errors";

let cachedGroq: Groq | null = null;

export function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AiError("AI_NOT_CONFIGURED", "GROQ_API_KEY is not configured.", 503);
  }
  if (!cachedGroq) {
    cachedGroq = new Groq({ apiKey });
  }
  return cachedGroq;
}

export type GroqJsonOptions = {
  systemPrompt: string;
  userPayload: unknown;
  schemaName?: string;
};

export async function groqJson<T>(options: GroqJsonOptions): Promise<T> {
  const client = getGroqClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create(
      {
        model: AI_MODEL,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: JSON.stringify(options.userPayload) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 2048,
      },
      { signal: controller.signal as unknown as AbortSignal },
    );

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new AiError("AI_INVALID_RESPONSE", "Empty completion content.", 502);
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new AiError("AI_INVALID_RESPONSE", "Model returned non-JSON content.", 502);
    }
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiError("AI_TIMEOUT", "Groq request timed out.", 504);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("429")) {
      throw new AiError("AI_RATE_LIMITED", message, 429);
    }
    throw new AiError("AI_PROVIDER_ERROR", message, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export { AI_MODEL };
