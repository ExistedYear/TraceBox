import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId || !UUID_RE.test(projectId)) return NextResponse.json({ error: "Valid project_id is required." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: project } = await supabase.from("projects").select("id, organization_id, is_archived").eq("id", projectId).maybeSingle();
  const { data: role } = await supabase.rpc("project_role", { p_project_id: projectId });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (role !== "DEVELOPER" && role !== "MAINTAINER") return NextResponse.json({ error: "Only Developers and Maintainers can manage GitHub." }, { status: 403 });
  if (project.is_archived) return NextResponse.json({ error: "Archived projects cannot use GitHub." }, { status: 409 });

  const db = supabase;
  const { data: installations, error: installationError } = await db
    .from("github_installations")
    .select("id, github_installation_id, github_account_login, github_account_type, repository_selection, status, permissions, last_verified_at, created_at, suspended_at")
    .eq("organization_id", project.organization_id)
    .order("created_at");
  if (installationError) return NextResponse.json({ error: "Could not load GitHub installations." }, { status: 500 });
  const installationIds = (installations ?? []).map((installation: { id: string }) => installation.id);
  const [{ data: repositories, error: repositoryError }, { data: bindings, error: bindingError }] = await Promise.all([
    installationIds.length ? db.from("github_repositories").select("id, installation_id, github_repository_id, owner_login, name, full_name, private, archived, default_branch, html_url, is_accessible, last_synced_at").in("installation_id", installationIds).order("full_name") : Promise.resolve({ data: [], error: null }),
    db.from("project_github_repositories").select("github_repository_id, is_primary, auto_resolve_enabled, target_branches, created_at, updated_at").eq("project_id", projectId),
  ]);
  if (repositoryError || bindingError) return NextResponse.json({ error: "Could not load GitHub repositories." }, { status: 500 });

  let webhookDeliveries: unknown[] = [];
  if (installations?.length) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("github_webhook_deliveries")
        .select("delivery_id, event_name, action, status, attempt_count, github_installation_id, github_repository_id, received_at, processed_at")
        .in("github_installation_id", installations.map((installation: { github_installation_id: number }) => installation.github_installation_id))
        .order("received_at", { ascending: false })
        .limit(40);
      if (error) console.error("GitHub webhook history could not be loaded", { code: error.code, message: error.message });
      webhookDeliveries = data ?? [];
    } catch (error) {
      console.error("GitHub webhook history is unavailable", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return NextResponse.json({ installations: installations ?? [], repositories: repositories ?? [], bindings: bindings ?? [], webhookDeliveries });
}
