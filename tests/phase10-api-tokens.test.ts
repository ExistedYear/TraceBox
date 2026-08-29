import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260057_phase10_api_tokens.sql", import.meta.url), "utf8");
const manager = readFileSync(new URL("../src/components/settings/api-tokens-manager.tsx", import.meta.url), "utf8");
const apiDocs = readFileSync(new URL("../docs/api.md", import.meta.url), "utf8");

describe("Phase 10 API token lifecycle", () => {
  it("validates hashes/scopes and rotates transactionally", () => {
    expect(migration).toContain("validate_api_token_metadata");
    expect(migration).toContain("rotate_api_token");
    expect(migration).toContain("for update");
    expect(migration).toContain("delete from public.api_tokens");
  });
  it("covers show-once, expiration, last-used, retry, rotate, and revoke UX", () => {
    expect(manager).toContain("cannot be shown again");
    expect(manager).toContain("expires_at");
    expect(manager).toContain("last_used_at");
    expect(manager).toContain("rotate_api_token");
    expect(manager).toContain("revoke_api_token");
    expect(manager).toContain("Please retry");
    expect(manager).toContain("Copy token");
    expect(manager).toContain("replacementExpiry");
    expect(manager).toContain("expires_at: replacementExpiry");
    expect(manager).toContain("Choose an expiration date in the future.");
    expect(manager).toContain("isFutureExpiry");
    expect(manager).toContain("old token will stop working immediately");
  });
  it("documents the actual API contract without inventing rate limits/history", () => {
    expect(apiDocs).toContain("Authorization: Bearer");
    expect(apiDocs).toContain("live project memberships");
    expect(apiDocs).toContain("does not currently promise an application rate limit");
    expect(apiDocs).toContain("last_used_at");
    expect(apiDocs).toContain("/api/v1/issues?project_id=");
    expect(apiDocs).toContain("422");
    expect(apiDocs).not.toContain("/api/v1/projects/PROJECT_ID/issues");
    expect(migration).toContain("v_deleted = 0");
  });
});
