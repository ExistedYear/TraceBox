import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, canApiAccessProject } from "@/lib/api-auth";
import { scopeGithubRepositoryCatalog } from "@/lib/github-repository-visibility";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Params = Promise<{ projectId: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const auth = await authenticateApiRequest(request, "integrations:read");
  if ("response" in auth) return auth.response;
  const projectId = (await params).projectId;
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: "Invalid project ID." }, { status: 400 });

  const db = auth.client;
  const { data: project, error: projectError } = await db.from("projects").select("id, organization_id").eq("id", projectId).eq("organization_id", auth.context.organizationId).eq("is_archived", false).maybeSingle();
  if (projectError) return NextResponse.json({ error: "Could not load the project." }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  try {
    if (!await canApiAccessProject(db, auth.context, project.id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Could not verify project access." }, { status: 500 });
  }

  const { data: installations, error: installationError } = await db
    .from("github_installations")
    .select("id, github_installation_id, github_account_login, github_account_type, status, permissions, last_verified_at")
    .eq("organization_id", auth.context.organizationId)
    .order("created_at");
  if (installationError) return NextResponse.json({ error: "Could not load GitHub installations." }, { status: 500 });

  const installationIds = (installations ?? []).map((installation: { id: string }) => installation.id);
  const [{ data: repositories, error: repositoryError }, { data: bindings, error: bindingError }] = await Promise.all([
    installationIds.length
      ? db.from("github_repositories").select("id, installation_id, github_repository_id, owner_login, name, full_name, private, archived, default_branch, html_url, is_accessible, last_synced_at").in("installation_id", installationIds).order("full_name")
      : Promise.resolve({ data: [], error: null }),
    db.from("project_github_repositories").select("github_repository_id, is_primary, auto_resolve_enabled, target_branches").eq("project_id", projectId),
  ]);
  if (repositoryError || bindingError) return NextResponse.json({ error: "Could not load GitHub repositories." }, { status: 500 });

  const projectBindings = bindings ?? [];
  const catalog = scopeGithubRepositoryCatalog({
    role: auth.context.organizationRole === "OWNER" || auth.context.organizationRole === "ADMIN" ? "MAINTAINER" : "DEVELOPER",
    installations: installations ?? [],
    repositories: repositories ?? [],
    bindings: projectBindings,
  });
  return NextResponse.json({ data: catalog.repositories, bindings: projectBindings, installations: catalog.installations });
}
