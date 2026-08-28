import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";
import { syncGithubInstallation } from "@/lib/github-repository-sync";
import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let projectId: string | null = null;
  try {
    const body = await request.json() as { project_id?: unknown };
    projectId = typeof body.project_id === "string" ? body.project_id : null;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!projectId || !UUID_RE.test(projectId)) return NextResponse.json({ error: "Valid project_id is required." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: project } = await supabase.from("projects").select("organization_id, is_archived").eq("id", projectId).maybeSingle();
  const { data: role } = await supabase.rpc("project_role", { p_project_id: projectId });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.is_archived) return NextResponse.json({ error: "Archived projects cannot sync GitHub." }, { status: 409 });
  if (role !== "DEVELOPER" && role !== "MAINTAINER") return NextResponse.json({ error: "Only Developers and Maintainers can sync GitHub." }, { status: 403 });

  const db = supabase;
  const { data: installations, error } = await db.from("github_installations").select("id, github_installation_id, status").eq("organization_id", project.organization_id);
  if (error) return NextResponse.json({ error: "Could not load GitHub installations." }, { status: 500 });
  const admin = createAdminClient();
  let synced = 0;
  let failed = 0;
  for (const installation of installations ?? []) {
    const result = await syncGithubInstallation(admin, installation);
    synced += result.synced;
    failed += result.failed;
  }
  return NextResponse.json({ success: true, synced, failed });
}
