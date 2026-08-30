import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { geminiJson } from "@/lib/ai/client";

const options = { systemPrompt: "Return JSON.", userPayload: { value: "test" }, schemaName: "test_schema", jsonSchema: { type: "object" } };
const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

describe("Gemini provider client", () => {
  it("requires the server-only Gemini API key", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(geminiJson(options)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });

  it("sends structured JSON generation requests and parses text output", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(geminiJson<{ ok: boolean }>(options)).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": "test-gemini-key" },
    }));
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: options.systemPrompt }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: JSON.stringify(options.userPayload) }] }]);
    expect(body.generationConfig).toEqual(expect.objectContaining({ responseFormat: { text: { mimeType: "application/json", schema: options.jsonSchema } } }));
  });

  it("maps Google rate-limit responses to the stable application error", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("quota exceeded", { status: 429 })));

    await expect(geminiJson(options)).rejects.toMatchObject({ code: "AI_RATE_LIMITED", message: "Trace Intelligence is rate limited. Try again shortly." });
  });
});
