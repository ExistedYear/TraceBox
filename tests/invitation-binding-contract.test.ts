import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260073_invitation_context_and_github_automation.sql", import.meta.url), "utf8");
const invitationUi = readFileSync(new URL("../src/components/settings/invitation-acceptance.tsx", import.meta.url), "utf8");
const bindingRoute = readFileSync(new URL("../src/app/api/github/bind/route.ts", import.meta.url), "utf8");
const githubUi = readFileSync(new URL("../src/components/settings/github-integration-manager.tsx", import.meta.url), "utf8");

describe("invitation and GitHub automation contracts", () => {
  it("keeps the old invitation RPC and adds a context-bearing acceptance result", () => {
    expect(migration).toContain("accept_organization_invitation_context");
    expect(migration).toContain("returns table (organization_id uuid, project_id uuid)");
    expect(migration).toContain("perform public.accept_organization_invitation(p_token)");
    expect(migration).toContain("grant execute on function public.accept_organization_invitation_context(text) to authenticated");
    expect(invitationUi).toContain('rpc("accept_organization_invitation_context"');
    expect(invitationUi).toContain("selectOrganization(context.organization_id)");
    expect(invitationUi).toContain("selectProject(context.project_id)");
    expect(invitationUi).toContain('router.push(context.project_id ? "/dashboard/issues" : "/dashboard")');
  });

  it("supports authenticated automation updates without exposing service credentials", () => {
    expect(bindingRoute).toContain("export async function PATCH");
    expect(bindingRoute).toContain('auth.getUser()');
    expect(bindingRoute).toContain('role !== "MAINTAINER"');
    expect(bindingRoute).toContain('rpc("bind_github_repository"');
    expect(githubUi).toContain("Save automation");
    expect(githubUi).toContain('method: "PATCH"');
    expect(githubUi).not.toContain("service_role");
  });
});
