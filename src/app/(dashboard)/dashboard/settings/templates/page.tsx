import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IssueTemplatesManager } from "@/components/settings/issue-templates-manager";
import { LoadError } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Issue templates" };

export default async function TemplatesSettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard/settings");
  const supabase = await createClient();
  const [{ data: templates, error: templatesError }, { data: canManage, error: manageError }] = await Promise.all([
    supabase.from("issue_templates").select("id, name, description, issue_type, body_template, default_priority, default_severity, default_component_id").eq("project_id", context.activeProject.id).order("name"),
    supabase.rpc("can_manage_project", { p_project_id: context.activeProject.id }),
  ]);
  const loadError = templatesError ?? manageError;
  if (loadError) {
    console.error("Issue template settings load failed", { code: loadError.code, message: loadError.message });
    return <LoadError title="Issue templates unavailable" description="We could not load the complete template configuration." retryHref="/dashboard/settings/templates" />;
  }
  return <IssueTemplatesManager projectId={context.activeProject.id} canManage={Boolean(canManage)} initialTemplates={(templates ?? []) as any} />;
}
