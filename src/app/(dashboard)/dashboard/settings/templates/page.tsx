import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IssueTemplatesManager } from "@/components/settings/issue-templates-manager";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Issue templates" };

export default async function TemplatesSettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard/settings");
  const supabase = await createClient();
  const { data: templates } = await supabase.from("issue_templates").select("id, name, description, issue_type, body_template, default_priority, default_severity, default_component_id").eq("project_id", context.activeProject.id).order("name");
  return <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8"><IssueTemplatesManager projectId={context.activeProject.id} initialTemplates={(templates ?? []) as any} /></main>;
}
