import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, filterApiVisibleIssues } from "@/lib/api-auth";
import { ISSUE_TYPES, PRIORITIES } from "@/lib/issues";
import { issueCreateSchema } from "@/lib/validation/issue";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ApiIssueRow = {
  id: string;
  project_id: string;
  visibility: string;
  reporter_id: string;
  assignee_id: string | null;
  issue_number: number;
  title: string;
  type: string;
  priority: string;
  severity: string;
  status: { name: string; category: string } | null;
  component: { name: string } | null;
  created_at: string;
  updated_at: string;
};

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
  const { data: project } = await auth.client.from("projects").select("id, organization_id").eq("id", projectId).eq("is_archived", false).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.organization_id !== auth.context.organizationId) return NextResponse.json({ error: "Project is not accessible with this token." }, { status: 403 });

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
  const allIssues: ApiIssueRow[] = [];
  const batchSize = 1000;
  for (let from = 0; ; from += batchSize) {
    let query = auth.client
      .from("issues")
      .select("id, project_id, visibility, reporter_id, assignee_id, issue_number, title, type, priority, severity, status:workflow_states(name, category), component:components(name), created_at, updated_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(from, from + batchSize - 1);
    if (status) query = query.eq("status_id", status);
    if (type) query = query.eq("type", type);
    if (priority) query = query.eq("priority", priority);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: "Could not load issues." }, { status: 500 });
    allIssues.push(...(data ?? []));
    if ((data ?? []).length < batchSize) break;
  }
  const visibleIds = new Set(await filterApiVisibleIssues(auth.client, auth.context, allIssues));
  const visible = allIssues.filter((issue) => visibleIds.has(issue.id));
  return NextResponse.json({ data: visible.slice(offset, offset + limit), total: visible.length, limit, offset });
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
  const parsed = issueCreateSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid issue payload.", details: parsed.error.flatten().fieldErrors }, { status: 422 });

  const projectId = (payload as Record<string, unknown>).project_id;
  if (typeof projectId !== "string" || !UUID_RE.test(projectId)) return NextResponse.json({ error: "Valid project_id is required." }, { status: 400 });
  const { data: project } = await auth.client.from("projects").select("organization_id").eq("id", projectId).eq("is_archived", false).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.organization_id !== auth.context.organizationId) return NextResponse.json({ error: "Project is not accessible with this token." }, { status: 403 });

  const { data: issueNumber, error } = await auth.client.rpc("api_create_issue", { p_token_hash: auth.context.tokenHash, p_payload: { ...parsed.data, project_id: projectId } });
  if (error) return NextResponse.json({ error: "Could not create issue." }, { status: 400 });
  return NextResponse.json({ success: true, issue_number: issueNumber }, { status: 201 });
}
