import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/202608260082_public_workspaces.sql", "utf8");
const joinFix = readFileSync("supabase/migrations/202608260083_public_workspace_join_idempotency.sql", "utf8");
const joinLock = readFileSync("supabase/migrations/202608260084_public_workspace_join_lock.sql", "utf8");
const seed = readFileSync("supabase/seed.sql", "utf8");
const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");
const landing = readFileSync("src/app/page.tsx", "utf8");
const invitationRoute = readFileSync("src/app/api/invitations/route.ts", "utf8");

describe("public workspace and submission contracts", () => {
  it("keeps public visibility opt-in and exposes only narrow RPCs", () => {
    expect(migration).toContain("is_public boolean not null default false");
    expect(migration).toContain("list_public_organizations");
    expect(migration).toContain("join_public_organization");
    expect(migration).toContain("'REPORTER'");
    expect(migration).toContain("revoke execute");
  });

  it("does not downgrade existing members or duplicate join audit events", () => {
    expect(joinFix).toContain("get diagnostics v_inserted = row_count");
    expect(joinFix).toContain("if v_inserted = 1 then");
  });

  it("serializes joining with workspace visibility changes", () => {
    expect(joinLock).toContain("for share");
    expect(joinLock).toContain("if not found then raise exception 'NOT_FOUND'");
  });

  it("ships an explicit disposable demo identity", () => {
    expect(seed).toContain("demo@123.com");
    expect(seed).toContain("crypt('demo123'");
    expect(seed).toContain("TraceBox Demo Workspace");
  });

  it("writes exchanged auth cookies onto the callback redirect", () => {
    expect(callback).toContain("createServerClient");
    expect(callback).toContain("response.cookies.set");
    expect(callback).toContain("exchangeCodeForSession");
  });

  it("keeps landing navigation on-page and publishes local source notes", () => {
    expect(landing).toContain('href="#workflow-guide"');
    expect(landing).toContain('href="#principles"');
    expect(landing).toContain('href="#security"');
    expect(landing).toContain('/assets/docs/workflow.md');
  });

  it("sends invitations only after same-origin authentication", () => {
    expect(invitationRoute).toContain("sameOrigin(request)");
    expect(invitationRoute).toContain("supabase.auth.getUser()");
    expect(invitationRoute).toContain("inviteUserByEmail");
  });

  it("declares the MIT license and private security reporting", () => {
    expect(readFileSync("LICENSE", "utf8")).toContain("MIT License");
    expect(readFileSync("SECURITY.md", "utf8")).toContain("Do not open a public GitHub issue");
  });
});
