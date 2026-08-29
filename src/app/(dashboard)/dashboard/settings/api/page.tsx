import type { Metadata } from "next";

import { ApiTokensManager } from "@/components/settings/api-tokens-manager";
import { LoadError } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "API tokens" };

export default async function ApiSettingsPage() {
  const context = await getWorkspaceContext();
  const supabase = await createClient();
  const { data, error } = await supabase.from("api_tokens").select("id, name, scopes, expires_at, last_used_at, created_at").eq("user_id", context.userId).eq("organization_id", context.activeOrganization.id).order("created_at", { ascending: false });
  if (error) {
    console.error("API token settings load failed", { code: error.code, message: error.message });
    return <LoadError title="API tokens unavailable" description="We could not load your API token inventory." retryHref="/dashboard/settings/api" />;
  }
  return <ApiTokensManager organizationId={context.activeOrganization.id} initialTokens={data ?? []} />;
}
