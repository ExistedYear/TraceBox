import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CustomFieldsManager } from "@/components/settings/custom-fields-manager";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Custom fields and API tokens" };

export default async function CustomFieldsSettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) redirect("/dashboard/settings");
  const supabase = await createClient();
  const [{ data: fields }, { data: tokens }, { data: canManage }] = await Promise.all([
    supabase.from("custom_fields").select("id, name, field_type, config, is_required").eq("project_id", context.activeProject.id).order("name"),
    supabase.from("api_tokens").select("id, name, scopes, expires_at, created_at").eq("user_id", context.userId).eq("organization_id", context.activeOrganization.id).order("created_at", { ascending: false }),
    supabase.rpc("can_manage_project", { p_project_id: context.activeProject.id }),
  ]);
  return <CustomFieldsManager projectId={context.activeProject.id} organizationId={context.activeOrganization.id} canManage={Boolean(canManage)} initialFields={(fields ?? []) as any} initialTokens={(tokens ?? []) as any} />;
}
