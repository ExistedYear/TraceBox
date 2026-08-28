import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: { project_id?: unknown; github_repository_id?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const projectId = typeof body.project_id === "string" ? body.project_id : "";
  const repositoryId = typeof body.github_repository_id === "string" ? body.github_repository_id : "";
  if (!UUID_RE.test(projectId) || !UUID_RE.test(repositoryId)) return NextResponse.json({ error: "Valid project_id and github_repository_id are required." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: role } = await supabase.rpc("project_role", { p_project_id: projectId });
  if (role !== "MAINTAINER") return NextResponse.json({ error: "Only Maintainers can change the primary repository." }, { status: 403 });
  const { error } = await (supabase as any).rpc("set_github_primary_repository", { p_project_id: projectId, p_github_repository_id: repositoryId });
  if (error) {
    console.error("GitHub primary repository update failed", { code: error.code, message: error.message, projectId, repositoryId });
    return NextResponse.json({ error: "Could not set the primary repository." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
