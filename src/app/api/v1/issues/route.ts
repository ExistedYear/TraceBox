import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, getApiMutationErrorStatus } from "@/lib/api-auth";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/issues";
import { issueCreatePayloadSchema } from "@/lib/validation/issue";
import type { Json } from "@/types/database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseBoundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (value === null || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "issues:read");
  if ("response" in auth) return auth.response;

  const projectId = request.nextUrl.searchParams.get("project_id");
  if (!projectId || !UUID_RE.test(projectId)) return NextResponse.json({ error: "Valid project_id is required." }, { status: 400 });
  const limit = parseBoundedInteger(request.nextUrl.searchParams.get("limit"), 25, 1, 100);
  const offset = parseBoundedInteger(request.nextUrl.searchParams.get("offset"), 0, 0, 1000000);
  if (limit === null || offset === null) return NextResponse.json({ error: "limit must be 1-100 and offset must be a non-negative integer." }, { status: 400 });
  const { data: project, error: projectError } = await auth.client.from("projects").select("id, organization_id").eq("id", projectId).eq("organization_id", auth.context.organizationId).eq("is_archived", false).maybeSingle();
  if (projectError) return NextResponse.json({ error: "Could not load the project." }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const status = request.nextUrl.searchParams.get("status");
  const type = request.nextUrl.searchParams.get("type");
  const priority = request.nextUrl.searchParams.get("priority");
  if (status && !UUID_RE.test(status)) return NextResponse.json({ error: "status must be a valid UUID." }, { status: 400 });
  if (type) {
    if (!(ISSUE_TYPES as readonly string[]).includes(type)) return NextResponse.json({ error: "Invalid issue type." }, { status: 400 });
  }
  if (priority) {
    if (!(PRIORITIES as readonly string[]).includes(priority)) return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }
  const { data, error } = await auth.client.rpc("api_list_issues", {
    p_token_hash: auth.context.tokenHash,
    p_project_id: projectId,
    p_status_id: status ?? undefined,
    p_type: type ?? undefined,
    p_priority: priority ?? undefined,
    p_limit: limit,
    p_offset: offset,
  });
  if (error?.code === "P0002") return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    console.error("API issue list failed", { code: error?.code, message: error?.message, projectId });
    return NextResponse.json({ error: "Could not load issues." }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "issues:write");
  if ("response" in auth) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = issueCreatePayloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid issue payload.", details: parsed.error.flatten().fieldErrors }, { status: 422 });

  const projectId = (payload as Record<string, unknown>).project_id;
  if (typeof projectId !== "string" || !UUID_RE.test(projectId)) return NextResponse.json({ error: "Valid project_id is required." }, { status: 400 });
  const { data: project, error: projectError } = await auth.client.from("projects").select("organization_id").eq("id", projectId).eq("organization_id", auth.context.organizationId).eq("is_archived", false).maybeSingle();
  if (projectError) return NextResponse.json({ error: "Could not load the project." }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const { data: issueNumber, error } = await auth.client.rpc("api_create_issue", { p_token_hash: auth.context.tokenHash, p_payload: { ...parsed.data, project_id: projectId } as unknown as Json });
  if (error) {
    console.error("API issue creation failed", { code: error.code, message: error.message, projectId });
    return NextResponse.json({ error: "Could not create issue." }, { status: getApiMutationErrorStatus(error) });
  }
  return NextResponse.json({ success: true, issue_number: issueNumber }, { status: 201 });
}
