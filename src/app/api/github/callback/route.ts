import { NextRequest, NextResponse } from "next/server";

import {
  classifyGithubApiError,
  createGithubInstallationToken,
  exchangeGithubUserCode,
  getGithubAppSlug,
  getGithubInstallationForUser,
  GithubApiError,
  invalidateGithubInstallationToken,
  listGithubInstallationRepositories,
} from "@/lib/github-app";
import { verifyGithubConnectState } from "@/lib/github-connect-state";
import { createAdminClient } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

function redirectToSettings(request: NextRequest, result: "connected" | "pending" | "error") {
  const url = new URL("/dashboard/settings/integrations", request.url);
  url.searchParams.set("github", result);
  const response = NextResponse.redirect(url);
  response.cookies.set("tb_github_connect_state", "", { httpOnly: true, maxAge: 0, path: "/api/github" });
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const installationId = Number(request.nextUrl.searchParams.get("installation_id"));
  const state = request.nextUrl.searchParams.get("state");
  const setupAction = request.nextUrl.searchParams.get("setup_action");
  if (!code || !state || !Number.isSafeInteger(installationId) || installationId < 1) return redirectToSettings(request, "error");

  try {
    const statePayload = verifyGithubConnectState(request.cookies.get("tb_github_connect_state")?.value, state);
    if (!statePayload) return redirectToSettings(request, "error");

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== statePayload.userId) return redirectToSettings(request, "error");

    const { data: project } = await supabase.from("projects").select("id, organization_id, is_archived").eq("id", statePayload.projectId).eq("organization_id", statePayload.organizationId).maybeSingle();
    const { data: role } = await supabase.rpc("project_role", { p_project_id: statePayload.projectId });
    if (!project || project.is_archived || role !== "MAINTAINER") return redirectToSettings(request, "error");

    // GitHub setup parameters are untrusted. The user access token proves that
    // this TraceBox user can see the installation before we persist its ID.
    const userToken = await exchangeGithubUserCode(code);
    const installation = await getGithubInstallationForUser(userToken, installationId);
    if (installation.id !== installationId || (installation.app_slug && installation.app_slug !== getGithubAppSlug())) return redirectToSettings(request, "error");

    const admin = createAdminClient();
    const status = installation.suspended_at ? "SUSPENDED" : setupAction === "request" ? "PENDING" : "ACTIVE";
    const { data: dbInstallationId, error: installationError } = await admin.rpc("upsert_github_installation", {
      p_organization_id: statePayload.organizationId,
      p_github_installation_id: installation.id,
      p_github_account_id: installation.account.id,
      p_github_account_login: installation.account.login,
      p_github_account_type: installation.account.type,
      p_repository_selection: installation.repository_selection,
      p_permissions: installation.permissions,
      p_status: status,
      p_installed_by: user.id,
    });
    if (installationError || !dbInstallationId) {
      console.error("GitHub installation persistence failed", { code: installationError?.code, message: installationError?.message });
      return redirectToSettings(request, "error");
    }

    if (status === "PENDING" || status === "SUSPENDED") return redirectToSettings(request, "pending");

    const installationToken = await createGithubInstallationToken(installationId);
    const repositories = await listGithubInstallationRepositories(installationToken.token);

    for (const repository of repositories) {
      const { error: repositoryError } = await admin.rpc("upsert_github_repository", {
        p_installation_id: dbInstallationId,
        p_github_repository_id: repository.id,
        p_owner_login: repository.owner.login,
        p_name: repository.name,
        p_full_name: repository.full_name,
        p_private: repository.private,
        p_archived: repository.archived,
        p_default_branch: repository.default_branch ?? undefined,
        p_html_url: repository.html_url,
        p_is_accessible: true,
      });
      if (repositoryError) {
        console.error("GitHub repository persistence failed", { code: repositoryError.code, message: repositoryError.message });
        return redirectToSettings(request, "error");
      }
    }
    return redirectToSettings(request, "connected");
  } catch (error) {
    const kind = error instanceof GithubApiError ? classifyGithubApiError(error) : "UNKNOWN";
    if (kind === "AUTH_REVOKED" || kind === "PERMISSION_MISSING") invalidateGithubInstallationToken(installationId);
    console.error("GitHub App callback failed", { error: error instanceof Error ? error.message : "unknown" });
    return redirectToSettings(request, "error");
  }
}
