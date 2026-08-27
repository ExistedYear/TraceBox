import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GithubIntegrationManager } from "@/components/settings/github-integration-manager";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsSettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard/settings");
  const supabase = await createClient();
  const { data: role } = await supabase.rpc("project_role", { p_project_id: context.activeProject.id });
  if (role !== "DEVELOPER" && role !== "MAINTAINER") redirect("/dashboard/settings");
  const db = supabase as any;
  const [{ data: legacy }, { data: installations }, { data: bindings }] = await Promise.all([
    supabase.from("project_integrations").select("repo_full_name, auto_resolve_enabled").eq("project_id", context.activeProject.id).eq("provider", "GITHUB").maybeSingle(),
    db.from("github_installations").select("id, github_installation_id, github_account_login, github_account_type, status, permissions, last_verified_at").eq("organization_id", context.activeOrganization.id).order("created_at"),
    db.from("project_github_repositories").select("github_repository_id, is_primary, auto_resolve_enabled, target_branches").eq("project_id", context.activeProject.id),
  ]);
  const installationIds = (installations ?? []).map((installation: { id: string }) => installation.id);
  const { data: organizationRepositories } = installationIds.length
    ? await db.from("github_repositories").select("id, installation_id, github_repository_id, owner_login, name, full_name, private, archived, default_branch, html_url, is_accessible, last_synced_at").in("installation_id", installationIds).order("full_name")
    : { data: [] };
  return <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8"><GithubIntegrationManager projectId={context.activeProject.id} initialLegacyRepo={legacy?.repo_full_name ?? null} initialInstallations={(installations ?? []) as any} initialRepositories={(organizationRepositories ?? []) as any} initialBindings={(bindings ?? []) as any} /></main>;
}
