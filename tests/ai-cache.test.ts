import { describe, expect, it, vi } from "vitest";

import { canonicalHash } from "@/lib/ai/hash";
import { AI_MODEL } from "@/lib/ai/config";

describe("AI cache hash stability", () => {
  it("cache hit would prevent provider call (hash stable)", () => {
    const input = { issue: { id: "1", title: "Hello" }, components: [{ id: "c1", name: "Auth" }] };
    const hash1 = canonicalHash(input, AI_MODEL);
    const hash2 = canonicalHash(input, AI_MODEL);
    expect(hash1).toBe(hash2);
  });

  it("cache miss when input changes", () => {
    const inputA = { issue: { title: "hello" } };
    const inputB = { issue: { title: "hello world" } };
    expect(canonicalHash(inputA, AI_MODEL)).not.toBe(canonicalHash(inputB, AI_MODEL));
  });

  it("mock provider not called on cache hit simulation", async () => {
    const provider = vi.fn(async () => ({ data: "ai result" }));
    const cache = new Map<string, unknown>();
    const input = { issue: { id: "1" } };
    const hash = canonicalHash(input, AI_MODEL);
    cache.set(hash, { cached: true });

    async function getTriage(inputHash: string) {
      if (cache.has(inputHash)) return cache.get(inputHash);
      const result = await provider();
      cache.set(inputHash, result);
      return result;
    }

    const first = await getTriage(hash);
    expect(provider).not.toHaveBeenCalled();
    expect(first).toEqual({ cached: true });

    const newHash = canonicalHash({ issue: { id: "2" } }, AI_MODEL);
    await getTriage(newHash);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
