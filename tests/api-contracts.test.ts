import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { API_SCOPES, API_TOKEN_PRESETS } from "../src/lib/api-scopes";

function latestPersistedScopes() {
  const directory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort().reverse();
  for (const file of files) {
    const sql = readFileSync(`${directory}/${file}`, "utf8");
    const match = sql.match(/alter table public\.api_tokens add constraint api_tokens_scopes_check check \([\s\S]*?scopes\s*<@\s*array\[([^\]]+)\]::text\[\]/);
    if (match) return [...match[1].matchAll(/'([^']+)'/g)].map((scope) => scope[1]);
  }
  throw new Error("The migration chain does not define api_tokens_scopes_check.");
}

describe("public API scope contract", () => {
  it("contains every scope accepted by the latest api_tokens constraint", () => {
    expect([...API_SCOPES].sort()).toEqual(latestPersistedScopes().sort());
  });

  it("keeps UI presets within the persisted scope contract", () => {
    for (const scopes of Object.values(API_TOKEN_PRESETS)) {
      expect(scopes.every((scope) => API_SCOPES.includes(scope))).toBe(true);
    }
  });
});
