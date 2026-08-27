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
  const { data } = await supabase.from("project_integrations").select("repo_full_name, auto_resolve_enabled").eq("project_id", context.activeProject.id).eq("provider", "GITHUB").maybeSingle();
  const { data: role } = await supabase.rpc("project_role", { p_project_id: context.activeProject.id });
  if (role !== "DEVELOPER" && role !== "MAINTAINER") redirect("/dashboard/settings");
  return <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8"><GithubIntegrationManager projectId={context.activeProject.id} initialRepo={data?.repo_full_name ?? null} initialAutoResolve={data?.auto_resolve_enabled ?? true} /></main>;
}
