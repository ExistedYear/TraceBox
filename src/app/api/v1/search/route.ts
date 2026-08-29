import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, filterApiVisibleIssues } from "@/lib/api-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "search:read");
  if ("response" in auth) return auth.response;
  const projectId = request.nextUrl.searchParams.get("project_id");
  const search = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!projectId || !UUID_RE.test(projectId) || search.length < 2 || search.length > 200) return NextResponse.json({ error: "Valid project_id and a 2-200 character q are required." }, { status: 400 });
  const { data: project } = await auth.client.from("projects").select("id").eq("id", projectId).eq("organization_id", auth.context.organizationId).eq("is_archived", false).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  const matches = [];
  const batchSize = 1000;
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await auth.client.from("issues").select("id, project_id, visibility, reporter_id, assignee_id, issue_number, title, type, priority, severity, created_at, updated_at").eq("project_id", project.id).or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`).order("updated_at", { ascending: false }).range(from, from + batchSize - 1);
    if (error) return NextResponse.json({ error: "Could not search issues." }, { status: 500 });
    matches.push(...(data ?? []));
    if ((data ?? []).length < batchSize) break;
  }
  // Filter before applying the public result limit so hidden restricted rows
  // cannot displace visible results and become inferable through result shape.
  const visibleIds = new Set(await filterApiVisibleIssues(auth.client, auth.context, matches));
  return NextResponse.json({ data: matches.filter((issue) => visibleIds.has(issue.id)).slice(0, 100) });
}
