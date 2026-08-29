import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "search:read");
  if ("response" in auth) return auth.response;
  const projectId = request.nextUrl.searchParams.get("project_id");
  const search = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!projectId || !UUID_RE.test(projectId) || search.length < 2 || search.length > 200) return NextResponse.json({ error: "Valid project_id and a 2-200 character q are required." }, { status: 400 });
  const { data: project, error: projectError } = await auth.client.from("projects").select("id").eq("id", projectId).eq("organization_id", auth.context.organizationId).eq("is_archived", false).maybeSingle();
  if (projectError) return NextResponse.json({ error: "Could not load the project." }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const { data, error } = await auth.client.rpc("api_search_issues", {
    p_token_hash: auth.context.tokenHash,
    p_project_id: project.id,
    p_query: search,
    p_limit: 100,
  });
  if (error?.code === "P0002") return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (error || !Array.isArray(data)) {
    console.error("API issue search failed", { code: error?.code, message: error?.message, projectId });
    return NextResponse.json({ error: "Could not search issues." }, { status: 500 });
  }
  return NextResponse.json({ data });
}
