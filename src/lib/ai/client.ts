import "server-only";
import Groq from "groq-sdk";
import { AI_MAX_CONTEXT_CHARS, AI_MAX_OUTPUT_CHARS, AI_MODEL, AI_TIMEOUT_MS } from "./config";
import { AiError, mapProviderError } from "./errors";

let client: Groq | null = null;
export function getGroqClient(): Groq {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new AiError("AI_NOT_CONFIGURED");
  if (!client) client = new Groq({ apiKey: key });
  return client;
}
export type GroqJsonOptions = { systemPrompt: string; userPayload: unknown; schemaName: string; jsonSchema: object; maxOutputTokens?: number };

export async function groqJson<T>(options: GroqJsonOptions): Promise<T> {
  const payload = JSON.stringify(options.userPayload);
  if (payload.length > AI_MAX_CONTEXT_CHARS || options.systemPrompt.length > AI_MAX_CONTEXT_CHARS) throw new AiError("AI_REQUEST_TOO_LARGE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const completion = await getGroqClient().chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "system", content: options.systemPrompt }, { role: "user", content: payload }],
      response_format: { type: "json_schema", json_schema: { name: options.schemaName, strict: true, schema: options.jsonSchema as { [key: string]: unknown } } },
      temperature: 0.1,
      max_completion_tokens: Math.min(options.maxOutputTokens ?? 2048, 4096),
      reasoning_effort: "low",
    }, { signal: controller.signal });
    const content = completion.choices[0]?.message?.content;
    if (!content || content.length > AI_MAX_OUTPUT_CHARS) throw new AiError("AI_INVALID_RESPONSE");
    try { return JSON.parse(content) as T; } catch { throw new AiError("AI_INVALID_RESPONSE"); }
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw mapProviderError(error);
  } finally { clearTimeout(timeout); }
}
export { AI_MODEL };
