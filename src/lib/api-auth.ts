import { createHash } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type ApiTokenContext = {
  tokenHash: string;
  tokenId: string;
  userId: string;
  organizationId: string;
  scopes: string[];
};
export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Server API credentials are not configured.");
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authenticateApiRequest(request: Request, requiredScope: "read" | "write"): Promise<
  | { context: ApiTokenContext; client: SupabaseClient<Database> }
  | { response: Response }
> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    return { response: Response.json({ error: "Missing Bearer token." }, { status: 401 }) };
  }

  const token = match[1];
  if (token.length < 32 || token.length > 512) {
    return { response: Response.json({ error: "Invalid API token." }, { status: 401 }) };
  }

  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const client = createAdminClient();
  const { data, error } = await client
    .from("api_tokens")
    .select("id, user_id, organization_id, scopes, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data || (data.expires_at && new Date(data.expires_at).getTime() <= Date.now())) {
    return { response: Response.json({ error: "Invalid or expired API token." }, { status: 401 }) };
  }
  const { data: membership } = await client.from("organization_members").select("user_id").eq("organization_id", data.organization_id).eq("user_id", data.user_id).maybeSingle();
  if (!membership) return { response: Response.json({ error: "API token owner is no longer an organization member." }, { status: 401 }) };

  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  if (!scopes.includes(requiredScope)) {
    return { response: Response.json({ error: `API token lacks ${requiredScope} scope.` }, { status: 403 }) };
  }

  await client.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return {
    client,
    context: {
      tokenHash,
      tokenId: data.id,
      userId: data.user_id,
      organizationId: data.organization_id,
      scopes,
    },
  };
}
export async function filterApiVisibleIssues(
  client: SupabaseClient<Database>,
  context: ApiTokenContext,
  issues: Array<{ id: string; project_id: string; visibility: string; reporter_id: string; assignee_id: string | null }>,
) {
  const projectIds = [...new Set(issues.map((issue) => issue.project_id))];
  const [{ data: projectMemberships }, { data: orgMembership }] = await Promise.all([
    client.from("project_members").select("project_id, role").eq("user_id", context.userId).in("project_id", projectIds),
    client.from("organization_members").select("role").eq("organization_id", context.organizationId).eq("user_id", context.userId).maybeSingle(),
  ]);
  const memberProjects = new Set((projectMemberships ?? []).map((row) => row.project_id));
  const maintainerProjects = new Set((projectMemberships ?? []).filter((row) => row.role === "MAINTAINER").map((row) => row.project_id));
  const isOrgAdmin = orgMembership?.role === "OWNER" || orgMembership?.role === "ADMIN";
  const restrictedIds = issues.filter((issue) => issue.visibility === "RESTRICTED").map((issue) => issue.id);
  const { data: grants } = restrictedIds.length ? await client.from("issue_access").select("issue_id").eq("user_id", context.userId).in("issue_id", restrictedIds) : { data: [] as Array<{ issue_id: string }> };
  const granted = new Set((grants ?? []).map((grant) => grant.issue_id));
  return issues.filter((issue) => issue.visibility !== "RESTRICTED" ? memberProjects.has(issue.project_id) || isOrgAdmin : isOrgAdmin || maintainerProjects.has(issue.project_id) || (memberProjects.has(issue.project_id) && (issue.reporter_id === context.userId || issue.assignee_id === context.userId || granted.has(issue.id)))).map((issue) => issue.id);
}
