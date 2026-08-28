import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, getApiAccessibleProjectIds } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "projects:read");
  if ("response" in auth) return auth.response;

  const organizationId = request.nextUrl.searchParams.get("organization_id");
  if (organizationId && organizationId !== auth.context.organizationId) {
    return NextResponse.json({ error: "Organization is not accessible with this token." }, { status: 403 });
  }

  let query = auth.client
    .from("projects")
    .select("id, key, name, description, organization_id, is_archived, created_at, updated_at")
    .eq("organization_id", auth.context.organizationId)
    .eq("is_archived", false)
    .order("name");

  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load projects." }, { status: 500 });
  const projects = data ?? [];
  const accessible = await getApiAccessibleProjectIds(auth.client, auth.context, projects.map((project) => project.id));
  return NextResponse.json({ data: projects.filter((project) => accessible.has(project.id)) });
}
