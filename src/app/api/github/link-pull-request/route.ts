import { NextRequest, NextResponse } from "next/server";

import { classifyGithubApiError, createGithubInstallationToken, getGithubPullRequest, getGithubPullRequestChecks, invalidateGithubInstallationToken, GithubApiError, summarizeGithubChecks } from "@/lib/github-app";
import { createAdminClient } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELATIONSHIPS = new Set(["FIXES", "REFERENCES", "IMPLEMENTS"]);

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const issueId = typeof body.issue_id === "string" ? body.issue_id : "";
  const projectId = typeof body.project_id === "string" ? body.project_id : "";
  const repositoryId = typeof body.repository_id === "string" ? body.repository_id : "";
  const number = typeof body.number === "number" ? body.number : Number(body.number);
  const relationship = typeof body.relationship === "string" ? body.relationship.toUpperCase() : "REFERENCES";
  if (!UUID_RE.test(issueId) || !UUID_RE.test(projectId) || !UUID_RE.test(repositoryId) || !Number.isSafeInteger(number) || number < 1 || !RELATIONSHIPS.has(relationship)) return NextResponse.json({ error: "Issue, project, repository, number, and relationship are required." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: issue } = await supabase.from("issues").select("id, project_id").eq("id", issueId).eq("project_id", projectId).maybeSingle();
  const { data: role } = await supabase.rpc("project_role", { p_project_id: projectId });
  if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  if (role !== "DEVELOPER" && role !== "MAINTAINER") return NextResponse.json({ error: "Only Developers and Maintainers can link pull requests." }, { status: 403 });
  const db = supabase as any;
  const { data: binding } = await db.from("project_github_repositories").select("github_repository_id").eq("project_id", projectId).eq("github_repository_id", repositoryId).maybeSingle();
  const { data: repository } = await db.from("github_repositories").select("id, installation_id, full_name, is_accessible, archived").eq("id", repositoryId).maybeSingle();
  if (!binding || !repository) return NextResponse.json({ error: "That repository is not bound to this project." }, { status: 403 });
  if (!repository.is_accessible || repository.archived) return NextResponse.json({ error: "That repository is unavailable to the GitHub App." }, { status: 409 });
  const { data: installation } = await db.from("github_installations").select("github_installation_id, status").eq("id", repository.installation_id).maybeSingle();
  if (!installation || installation.status !== "ACTIVE") return NextResponse.json({ error: "The GitHub installation needs attention before it can be used." }, { status: 409 });
  const [owner, name] = repository.full_name.split("/");
  if (!owner || !name) return NextResponse.json({ error: "Repository metadata is invalid." }, { status: 502 });

  try {
    const token = await createGithubInstallationToken(installation.github_installation_id);
    const pullRequest = await getGithubPullRequest(token.token, owner, name, number);
    const { data: artifactId, error: artifactError } = await (createAdminClient() as any).rpc("upsert_github_artifact", {
      p_github_repository_id: repository.id,
      p_artifact_type: "PULL_REQUEST",
      p_external_key: `pr:${pullRequest.number}`,
      p_github_id: pullRequest.id,
      p_github_node_id: pullRequest.node_id ?? null,
      p_number: pullRequest.number,
      p_title: pullRequest.title,
      p_html_url: pullRequest.html_url,
      p_state: pullRequest.state,
      p_draft: pullRequest.draft === true,
      p_merged: Boolean(pullRequest.merged_at),
      p_author_login: pullRequest.user?.login ?? null,
      p_head_sha: pullRequest.head?.sha ?? null,
      p_base_branch: pullRequest.base?.ref ?? null,
      p_head_branch: pullRequest.head?.ref ?? null,
      p_merge_commit_sha: pullRequest.merge_commit_sha ?? null,
      p_closed_at: pullRequest.closed_at ?? null,
      p_merged_at: pullRequest.merged_at ?? null,
      p_github_created_at: pullRequest.created_at,
      p_github_updated_at: pullRequest.updated_at,
    });
    if (artifactError || !artifactId) {
      console.error("GitHub PR artifact upsert failed", { code: artifactError?.code, message: artifactError?.message, repositoryId, number });
      return NextResponse.json({ error: "Could not save the GitHub pull request." }, { status: 500 });
    }
    let checks: ReturnType<typeof summarizeGithubChecks> | null = null;
    try {
      if (pullRequest.head?.sha) checks = summarizeGithubChecks(await getGithubPullRequestChecks(token.token, owner, name, pullRequest.head.sha));
    } catch (error) {
      checks = { state: "UNKNOWN", totalCount: 0, completedCount: 0, successfulCount: 0, failedCount: 0, pendingCount: 0, checks: [] };
      const kind = error instanceof GithubApiError ? classifyGithubApiError(error) : "UNKNOWN";
      if (error instanceof GithubApiError && (kind === "AUTH_REVOKED" || kind === "PERMISSION_MISSING")) invalidateGithubInstallationToken(installation.github_installation_id);
      console.error("GitHub PR checks fetch failed", { repositoryId, number, kind });
    }
    const admin = createAdminClient() as any;
    if (checks) await admin.rpc("upsert_github_pr_check_summary", { p_github_artifact_id: artifactId, p_state: checks.state, p_total_count: checks.totalCount, p_completed_count: checks.completedCount, p_successful_count: checks.successfulCount, p_failed_count: checks.failedCount, p_pending_count: checks.pendingCount, p_checks: checks.checks, p_error: null });
    const { data: linkId, error: linkError } = await admin.rpc("link_github_artifact", { p_issue_id: issueId, p_github_artifact_id: artifactId, p_relationship: relationship, p_source: "MANUAL" });
    if (linkError || !linkId) {
      console.error("GitHub PR link failed", { code: linkError?.code, message: linkError?.message, issueId, artifactId });
      return NextResponse.json({ error: "Could not link that pull request." }, { status: 400 });
    }
    return NextResponse.json({ link_id: linkId, artifact_id: artifactId, repository: repository.full_name, number: pullRequest.number, title: pullRequest.title, url: pullRequest.html_url, state: pullRequest.state.toUpperCase(), draft: pullRequest.draft === true, merged: Boolean(pullRequest.merged_at), author_login: pullRequest.user?.login ?? null, head_branch: pullRequest.head?.ref ?? null, base_branch: pullRequest.base?.ref ?? null, head_sha: pullRequest.head?.sha ?? null, relationship, checks });
  } catch (error) {
    const kind = error instanceof GithubApiError ? classifyGithubApiError(error) : "UNKNOWN";
    if (error instanceof GithubApiError && (kind === "AUTH_REVOKED" || kind === "PERMISSION_MISSING")) invalidateGithubInstallationToken(installation.github_installation_id);
    console.error("GitHub pull request link failed", { issueId, repositoryId, number, kind, status: error instanceof GithubApiError ? error.status : null });
    if (error instanceof GithubApiError && kind === "NOT_FOUND") return NextResponse.json({ error: "GitHub could not find that pull request." }, { status: 404 });
    if (error instanceof GithubApiError && kind === "RATE_LIMITED") return NextResponse.json({ error: "GitHub rate limit reached. Try again later." }, { status: 429 });
    if (error instanceof GithubApiError && kind === "PERMISSION_MISSING") return NextResponse.json({ error: "The GitHub App needs pull request read permission." }, { status: 409 });
    return NextResponse.json({ error: "Could not verify that pull request with GitHub." }, { status: 502 });
  }
}
