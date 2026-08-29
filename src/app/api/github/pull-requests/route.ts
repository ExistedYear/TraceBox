import { NextRequest, NextResponse } from "next/server";

import { classifyGithubApiError, createGithubInstallationToken, invalidateGithubInstallationToken, listGithubPullRequests, GithubApiError } from "@/lib/github-app";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  const repositoryId = request.nextUrl.searchParams.get("repository_id");
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  const stateParam = request.nextUrl.searchParams.get("state") ?? "open";
  const state = stateParam === "closed" || stateParam === "all" ? stateParam : "open";
  const page = Math.min(Math.max(Number(request.nextUrl.searchParams.get("page") ?? "1"), 1), 10);
  if (!projectId || !UUID_RE.test(projectId) || !repositoryId || !UUID_RE.test(repositoryId)) return NextResponse.json({ error: "Valid project_id and repository_id are required." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError && !isMissingAuthSession(userError)) return NextResponse.json({ error: "Could not verify authentication." }, { status: 500 });
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const [{ data: project, error: projectError }, { data: role, error: roleError }] = await Promise.all([
    supabase.from("projects").select("id, is_archived").eq("id", projectId).maybeSingle(),
    supabase.rpc("project_role", { p_project_id: projectId }),
  ]);
  if (projectError || roleError) {
    console.error("GitHub pull request authorization lookup failed", { projectCode: projectError?.code, roleCode: roleError?.code, projectId });
    return NextResponse.json({ error: "Could not verify GitHub access." }, { status: 500 });
  }
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.is_archived) return NextResponse.json({ error: "Archived projects cannot use GitHub." }, { status: 409 });
  if (role !== "VIEWER" && role !== "REPORTER" && role !== "DEVELOPER" && role !== "MAINTAINER") return NextResponse.json({ error: "You do not have access to this project." }, { status: 403 });

  const db = supabase as any;
  const { data: binding, error: bindingError } = await db.from("project_github_repositories").select("github_repository_id").eq("project_id", projectId).eq("github_repository_id", repositoryId).maybeSingle();
  if (bindingError) return NextResponse.json({ error: "Could not load the repository binding." }, { status: 500 });
  if (!binding) return NextResponse.json({ error: "That repository is not bound to this project." }, { status: 403 });
  const { data: repository, error: repositoryError } = await db.from("github_repositories").select("id, installation_id, full_name, is_accessible, archived").eq("id", repositoryId).maybeSingle();
  if (repositoryError) return NextResponse.json({ error: "Could not load the GitHub repository." }, { status: 500 });
  if (!repository) return NextResponse.json({ error: "Repository not found." }, { status: 404 });
  if (!repository.is_accessible || repository.archived) return NextResponse.json({ error: "That repository is unavailable to the GitHub App." }, { status: 409 });
  const { data: installation, error: installationError } = await db.from("github_installations").select("github_installation_id, status").eq("id", repository.installation_id).maybeSingle();
  if (installationError) return NextResponse.json({ error: "Could not load the GitHub installation." }, { status: 500 });
  if (!installation || installation.status !== "ACTIVE") return NextResponse.json({ error: "The GitHub installation needs attention before pull requests can be loaded." }, { status: 409 });

  const [owner, name] = repository.full_name.split("/");
  if (!owner || !name) return NextResponse.json({ error: "Repository metadata is invalid." }, { status: 502 });
  try {
    const token = await createGithubInstallationToken(installation.github_installation_id);
    const pullRequests = [] as Awaited<ReturnType<typeof listGithubPullRequests>>;
    const pagesToScan = query ? 10 : 1;
    let lastPageCount = 0;
    for (let currentPage = page; currentPage < page + pagesToScan && currentPage <= 10; currentPage += 1) {
      const pageResults = await listGithubPullRequests(token.token, owner, name, { state, page: currentPage, perPage: 100 });
      pullRequests.push(...pageResults);
      lastPageCount = pageResults.length;
      if (pageResults.length < 100) break;
    }
    const normalized = pullRequests
      .filter((pullRequest) => !query || `${pullRequest.number} ${pullRequest.title} ${pullRequest.user?.login ?? ""}`.toLowerCase().includes(query.toLowerCase()))
      .map((pullRequest) => ({
        github_id: pullRequest.id,
        number: pullRequest.number,
        title: pullRequest.title,
        state: pullRequest.state.toUpperCase(),
        draft: pullRequest.draft === true,
        merged: Boolean(pullRequest.merged_at),
        author_login: pullRequest.user?.login ?? null,
        head_branch: pullRequest.head?.ref ?? null,
        base_branch: pullRequest.base?.ref ?? null,
        head_sha: pullRequest.head?.sha ?? null,
        html_url: pullRequest.html_url,
        updated_at: pullRequest.updated_at,
      }));
    return NextResponse.json({ repository: { id: repository.id, full_name: repository.full_name }, pull_requests: normalized, page, has_more: lastPageCount === 100 && page + pagesToScan <= 10 });
  } catch (error) {
    const kind = error instanceof GithubApiError ? classifyGithubApiError(error) : "UNKNOWN";
    if (error instanceof GithubApiError && (kind === "AUTH_REVOKED" || kind === "PERMISSION_MISSING")) invalidateGithubInstallationToken(installation.github_installation_id);
    console.error("GitHub pull request search failed", { projectId, repositoryId, kind, status: error instanceof GithubApiError ? error.status : null });
    if (error instanceof GithubApiError && kind === "RATE_LIMITED") return NextResponse.json({ error: "GitHub rate limit reached. Try again later." }, { status: 429 });
    if (error instanceof GithubApiError && kind === "PERMISSION_MISSING") return NextResponse.json({ error: "The GitHub App needs pull request read permission for this repository." }, { status: 409 });
    if (error instanceof GithubApiError && kind === "AUTH_REVOKED") return NextResponse.json({ error: "The GitHub installation is no longer available." }, { status: 409 });
    return NextResponse.json({ error: "Could not load pull requests from GitHub." }, { status: 502 });
  }
}
