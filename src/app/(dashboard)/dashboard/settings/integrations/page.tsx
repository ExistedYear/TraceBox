import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GithubIntegrationManager } from "@/components/settings/github-integration-manager";
import { LoadError } from "@/components/tracebox/load-error";
import { scopeGithubRepositoryCatalog } from "@/lib/github-repository-visibility";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsSettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard/settings");
  const supabase = await createClient();
  const { data: role, error: roleError } = await supabase.rpc("project_role", { p_project_id: context.activeProject.id });
  if (roleError) {
    console.error("GitHub integrations role lookup failed", { code: roleError.code, message: roleError.message, projectId: context.activeProject.id });
    return <LoadError title="Integrations unavailable" description="We could not verify your GitHub integration access." retryHref="/dashboard/settings/integrations" />;
  }
  if (role !== "DEVELOPER" && role !== "MAINTAINER") redirect("/dashboard/settings");
  const db = supabase as any;
  const [{ data: legacy, error: legacyError }, { data: installations, error: installationsError }, { data: bindings, error: bindingsError }, { data: operations, error: operationsError }] = await Promise.all([
    supabase.from("project_integrations").select("repo_full_name, auto_resolve_enabled").eq("project_id", context.activeProject.id).eq("provider", "GITHUB").maybeSingle(),
    db.from("github_installations").select("id, github_installation_id, github_account_login, github_account_type, repository_selection, status, permissions, last_verified_at, created_at, suspended_at").eq("organization_id", context.activeOrganization.id).order("created_at"),
    db.from("project_github_repositories").select("github_repository_id, is_primary, auto_resolve_enabled, target_branches, created_at, updated_at").eq("project_id", context.activeProject.id),
    supabase.rpc("get_github_operations", { p_project_id: context.activeProject.id }),
  ]);
  const installationIds = (installations ?? []).map((installation: { id: string }) => installation.id);
  const { data: organizationRepositories, error: repositoriesError } = installationIds.length
    ? await db.from("github_repositories").select("id, installation_id, github_repository_id, owner_login, name, full_name, private, archived, default_branch, html_url, is_accessible, last_synced_at").in("installation_id", installationIds).order("full_name")
    : { data: [], error: null };
  const loadError = legacyError ?? installationsError ?? bindingsError ?? repositoriesError ?? operationsError;
  if (loadError) {
    console.error("GitHub integrations load failed", { code: loadError.code, message: loadError.message });
    return <LoadError title="Integrations unavailable" description="We could not load this project's GitHub status. Try again in a moment." retryHref="/dashboard/settings/integrations" />;
  }
  const catalog = scopeGithubRepositoryCatalog({ role, installations: installations ?? [], repositories: organizationRepositories ?? [], bindings: bindings ?? [] });
  const operationData = (operations ?? {}) as { deliveries?: unknown[] };
  return <GithubIntegrationManager projectId={context.activeProject.id} canManage={role === "MAINTAINER"} initialLegacyRepo={legacy?.repo_full_name ?? null} initialInstallations={catalog.installations as any} initialRepositories={catalog.repositories as any} initialBindings={catalog.bindings as any} initialWebhookDeliveries={(operationData.deliveries ?? []) as any} />;
}
