import { createHash } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { type ApiScope } from "@/lib/api-scopes";
import type { Database } from "@/types/database";

export type { ApiScope } from "@/lib/api-scopes";

export type ApiTokenContext = {
  tokenHash: string;
  tokenId: string;
  userId: string;
  organizationId: string;
  organizationRole: string;
  scopes: string[];
};

export function getApiMutationErrorStatus(error: { code?: string; message?: string }) {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "42501" || message.includes("NOT_ALLOWED")) return 403;
  if (code === "P0002" || message.includes("NOT_FOUND")) return 404;
  if (code === "40001" || code === "40P01" || code === "23503" || code === "23505" || message.includes("CONFLICT") || message.includes("PROJECT_ARCHIVED")) return 409;
  if (code.startsWith("22") || code === "23514" || message.includes("VALIDATION") || message.includes("INVALID_")) return 422;
  if (code === "P0001") return 400;
  return 500;
}

function hasScope(scopes: string[], requiredScope: ApiScope) {
  if (scopes.includes(requiredScope)) return true;
  return requiredScope.endsWith(":read") ? scopes.includes("read") : scopes.includes("write");
}
export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Server API credentials are not configured.");
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authenticateApiRequest(request: Request, requiredScope: ApiScope): Promise<
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
  let client: SupabaseClient<Database>;
  try {
    client = createAdminClient();
  } catch (error) {
    console.error("API server client creation failed", { error: error instanceof Error ? error.message : "unknown" });
    return { response: Response.json({ error: "API service is not configured." }, { status: 503 }) };
  }
  let tokenResult;
  try {
    tokenResult = await client
      .from("api_tokens")
      .select("id, user_id, organization_id, scopes, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
  } catch (error) {
    console.error("API token request failed", { error: error instanceof Error ? error.message : "unknown" });
    return { response: Response.json({ error: "Could not verify API credentials." }, { status: 500 }) };
  }
  const { data, error } = tokenResult;

  if (error) {
    console.error("API token lookup failed", { code: error.code, message: error.message });
    return { response: Response.json({ error: "Could not verify API credentials." }, { status: 500 }) };
  }
  if (!data || (data.expires_at && new Date(data.expires_at).getTime() <= Date.now())) {
    return { response: Response.json({ error: "Invalid or expired API token." }, { status: 401 }) };
  }
  let membershipResult;
  try {
    membershipResult = await client.from("organization_members").select("user_id, role").eq("organization_id", data.organization_id).eq("user_id", data.user_id).maybeSingle();
  } catch (error) {
    console.error("API token membership request failed", { error: error instanceof Error ? error.message : "unknown", tokenId: data.id });
    return { response: Response.json({ error: "Could not verify API credentials." }, { status: 500 }) };
  }
  const { data: membership, error: membershipError } = membershipResult;
  if (membershipError) {
    console.error("API token membership lookup failed", { code: membershipError.code, message: membershipError.message, tokenId: data.id });
    return { response: Response.json({ error: "Could not verify API credentials." }, { status: 500 }) };
  }
  if (!membership) return { response: Response.json({ error: "API token owner is no longer an organization member." }, { status: 401 }) };

  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  if (!hasScope(scopes, requiredScope)) {
    return { response: Response.json({ error: `API token lacks ${requiredScope} scope.` }, { status: 403 }) };
  }

  try {
    const { error: usageError } = await client.rpc("touch_api_token", { p_token_hash: tokenHash });
    if (usageError) console.error("API token usage timestamp failed", { code: usageError.code, message: usageError.message, tokenId: data.id });
  } catch (error) {
    console.error("API token usage timestamp request failed", { error: error instanceof Error ? error.message : "unknown", tokenId: data.id });
  }
  return {
    client,
    context: {
      tokenHash,
      tokenId: data.id,
      userId: data.user_id,
      organizationId: data.organization_id,
      organizationRole: membership.role,
      scopes,
    },
  };
}
export async function getApiAccessibleProjectIds(client: SupabaseClient<Database>, context: ApiTokenContext, projectIds: string[]) {
  if (context.organizationRole === "OWNER" || context.organizationRole === "ADMIN") return new Set(projectIds);
  if (!projectIds.length) return new Set<string>();
  const { data, error } = await client.from("project_members").select("project_id").eq("user_id", context.userId).in("project_id", projectIds);
  if (error) throw new Error(`API_PROJECT_ACCESS_LOOKUP_FAILED:${error.code}`);
  return new Set((data ?? []).map((row) => row.project_id));
}

export async function canApiAccessProject(client: SupabaseClient<Database>, context: ApiTokenContext, projectId: string) {
  return (await getApiAccessibleProjectIds(client, context, [projectId])).has(projectId);
}
export async function filterApiVisibleIssues(
  client: SupabaseClient<Database>,
  context: ApiTokenContext,
  issues: Array<{ id: string; project_id: string; visibility: string; reporter_id: string; assignee_id: string | null }>,
) {
  const projectIds = [...new Set(issues.map((issue) => issue.project_id))];
  const [{ data: projects, error: projectsError }, { data: projectMemberships, error: projectMembershipsError }, { data: orgMembership, error: orgMembershipError }] = await Promise.all([
    client.from("projects").select("id").eq("organization_id", context.organizationId).in("id", projectIds),
    client.from("project_members").select("project_id, role").eq("user_id", context.userId).in("project_id", projectIds),
    client.from("organization_members").select("role").eq("organization_id", context.organizationId).eq("user_id", context.userId).maybeSingle(),
  ]);
  if (projectsError || projectMembershipsError || orgMembershipError) throw new Error("API_ISSUE_VISIBILITY_LOOKUP_FAILED");
  const organizationProjects = new Set((projects ?? []).map((row) => row.id));
  const memberProjects = new Set((projectMemberships ?? []).map((row) => row.project_id));
  const maintainerProjects = new Set((projectMemberships ?? []).filter((row) => row.role === "MAINTAINER").map((row) => row.project_id));
  const isOrgAdmin = orgMembership?.role === "OWNER" || orgMembership?.role === "ADMIN";
  const restrictedIds = issues.filter((issue) => issue.visibility === "RESTRICTED").map((issue) => issue.id);
  const { data: grants, error: grantsError } = restrictedIds.length ? await client.from("issue_access").select("issue_id").eq("user_id", context.userId).in("issue_id", restrictedIds) : { data: [] as Array<{ issue_id: string }>, error: null };
  if (grantsError) throw new Error("API_ISSUE_GRANT_LOOKUP_FAILED");
  const granted = new Set((grants ?? []).map((grant) => grant.issue_id));
  return issues.filter((issue) => organizationProjects.has(issue.project_id) && (isOrgAdmin || memberProjects.has(issue.project_id)) && (issue.visibility !== "RESTRICTED" ? true : isOrgAdmin || maintainerProjects.has(issue.project_id) || issue.reporter_id === context.userId || issue.assignee_id === context.userId || granted.has(issue.id))).map((issue) => issue.id);
}
