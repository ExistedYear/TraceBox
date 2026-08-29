import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, canApiAccessProject } from "@/lib/api-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "milestones:read");
  if ("response" in auth) return auth.response;
  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId || !UUID_RE.test(projectId)) return NextResponse.json({ error: "Valid project_id is required." }, { status: 400 });
  const { data: project, error: projectError } = await auth.client.from("projects").select("id").eq("id", projectId).eq("organization_id", auth.context.organizationId).eq("is_archived", false).maybeSingle();
  if (projectError) return NextResponse.json({ error: "Could not load the project." }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  try {
    if (!await canApiAccessProject(auth.client, auth.context, project.id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Could not verify project access." }, { status: 500 });
  }
  const { data, error } = await auth.client.from("milestones").select("id, project_id, name, description, status, due_at, created_at, updated_at").eq("project_id", project.id).order("due_at");
  if (error) return NextResponse.json({ error: "Could not load milestones." }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
