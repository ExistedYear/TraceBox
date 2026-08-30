import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openRouterJson } from "@/lib/ai/client";

const options = { systemPrompt: "Return JSON.", userPayload: { value: "test" }, schemaName: "test_schema", jsonSchema: { type: "object" } };
const originalKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

describe("OpenRouter provider client", () => {
  it("requires the server-only OpenRouter API key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(openRouterJson(options)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("sends structured JSON generation requests and parses text output", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(openRouterJson<{ ok: boolean }>(options)).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-openrouter-key" },
    }));
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.model).toBe("z-ai/glm-5.2:free");
    expect(body.messages).toEqual([{ role: "system", content: options.systemPrompt }, { role: "user", content: JSON.stringify(options.userPayload) }]);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: options.schemaName, strict: true, schema: options.jsonSchema } });
  });

  it("maps OpenRouter rate-limit responses to the stable application error", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("quota exceeded", { status: 429 })));

    await expect(openRouterJson(options)).rejects.toMatchObject({ code: "AI_RATE_LIMITED", message: "Trace Intelligence is rate limited. Try again shortly." });
  });
});
