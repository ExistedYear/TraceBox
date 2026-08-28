import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GithubIntegrationManager } from "@/components/settings/github-integration-manager";
import { createAdminClient } from "@/lib/api-auth";
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
    db.from("github_installations").select("id, github_installation_id, github_account_login, github_account_type, repository_selection, status, permissions, last_verified_at, created_at, suspended_at").eq("organization_id", context.activeOrganization.id).order("created_at"),
    db.from("project_github_repositories").select("github_repository_id, is_primary, auto_resolve_enabled, target_branches, created_at, updated_at").eq("project_id", context.activeProject.id),
  ]);
  const installationIds = (installations ?? []).map((installation: { id: string }) => installation.id);
  const { data: organizationRepositories } = installationIds.length
    ? await db.from("github_repositories").select("id, installation_id, github_repository_id, owner_login, name, full_name, private, archived, default_branch, html_url, is_accessible, last_synced_at").in("installation_id", installationIds).order("full_name")
    : { data: [] };
  let webhookDeliveries: unknown[] = [];
  if (installationIds.length) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.from("github_webhook_deliveries").select("delivery_id, event_name, action, status, attempt_count, github_installation_id, github_repository_id, received_at, processed_at").in("github_installation_id", (installations ?? []).map((installation: { github_installation_id: number }) => installation.github_installation_id)).order("received_at", { ascending: false }).limit(40);
      if (error) console.error("GitHub integration history could not be loaded", { code: error.code, message: error.message });
      webhookDeliveries = data ?? [];
    } catch (error) {
      console.error("GitHub integration history is unavailable", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return <GithubIntegrationManager projectId={context.activeProject.id} canManage={role === "MAINTAINER"} initialLegacyRepo={legacy?.repo_full_name ?? null} initialInstallations={(installations ?? []) as any} initialRepositories={(organizationRepositories ?? []) as any} initialBindings={(bindings ?? []) as any} initialWebhookDeliveries={webhookDeliveries as any} />;
}
