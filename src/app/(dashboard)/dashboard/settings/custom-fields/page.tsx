import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CustomFieldsManager } from "@/components/settings/custom-fields-manager";
import { LoadError } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Custom fields" };

export default async function CustomFieldsSettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard/settings");
  const supabase = await createClient();
  const [{ data: fields, error: fieldsError }, { data: canManage, error: manageError }] = await Promise.all([
    supabase.from("custom_fields").select("id, name, field_type, config, is_required").eq("project_id", context.activeProject.id).order("name"),
    supabase.rpc("can_manage_project", { p_project_id: context.activeProject.id }),
  ]);
  const loadError = fieldsError ?? manageError;
  if (loadError) {
    console.error("Custom field settings load failed", { code: loadError.code, message: loadError.message });
    return <LoadError title="Custom fields unavailable" description="We could not load the complete custom-field configuration." retryHref="/dashboard/settings/custom-fields" />;
  }
  return <CustomFieldsManager projectId={context.activeProject.id} canManage={Boolean(canManage)} initialFields={(fields ?? []) as any} />;
}
