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
  const [{ data: templates, error: templatesError }, { data: canManage, error: manageError }, { data: components, error: componentsError }, { data: labels, error: labelsError }, { data: templateLabels, error: templateLabelsError }] = await Promise.all([
    (supabase.from("issue_templates") as any).select("id, name, description, issue_type, body_template, default_priority, default_severity, default_component_id, is_archived").eq("project_id", context.activeProject.id).order("name"),
    supabase.rpc("can_manage_project", { p_project_id: context.activeProject.id }),
    supabase.from("components").select("id, name").eq("project_id", context.activeProject.id).eq("is_archived", false).order("name"),
    supabase.from("labels").select("id, name").eq("project_id", context.activeProject.id).order("name"),
    (supabase as any).from("issue_template_labels").select("template_id, label_id"),
  ]);
  const loadError = templatesError ?? manageError ?? componentsError ?? labelsError ?? templateLabelsError;
  if (loadError) {
    console.error("Issue template settings load failed", { code: loadError.code, message: loadError.message });
    return <LoadError title="Issue templates unavailable" description="We could not load the complete template configuration." retryHref="/dashboard/settings/templates" />;
  }
  const labelMap = new Map<string, string[]>();
  for (const row of templateLabels ?? []) labelMap.set(row.template_id, [...(labelMap.get(row.template_id) ?? []), row.label_id]);
  const enriched = (templates ?? []).map((template: { id: string; [key: string]: unknown }) => ({ ...template, label_ids: labelMap.get(template.id) ?? [] }));
  return <IssueTemplatesManager projectId={context.activeProject.id} canManage={Boolean(canManage)} initialTemplates={enriched as any} components={(components ?? []) as any} labels={(labels ?? []) as any} />;
}
