import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get("project_id");
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

  if (!projectId) {
    return NextResponse.json({ error: "project_id query parameter is required" }, { status: 400 });
  }

  let query = supabase
    .from("issues")
    .select("id, issue_number, title, type, priority, severity, status:workflow_states(name, category), component:components(name), created_at, updated_at", { count: "exact" })
    .eq("project_id", projectId)
    .range(offset, offset + limit - 1)
    .order("created_at", { ascending: false });

  const status = searchParams.get("status");
  if (status) query = query.eq("status_id", status);

  const type = searchParams.get("type");
  if (type) query = query.eq("type", type);

  const priority = searchParams.get("priority");
  if (priority) query = query.eq("priority", priority);

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.project_id || !body.title) {
    return NextResponse.json({ error: "project_id and title are required" }, { status: 400 });
  }

  const { data: issueNumber, error } = await supabase.rpc("create_issue", {
    p_project_id: body.project_id,
    p_title: body.title,
    p_description: body.description || undefined,
    p_type: body.type || "BUG",
    p_priority: body.priority || "P2",
    p_severity: body.severity || "MAJOR",
    p_component_id: body.component_id || undefined,
    p_assignee_id: body.assignee_id || undefined,
    p_environment: body.environment || undefined,
    p_steps_to_reproduce: body.steps_to_reproduce || undefined,
    p_expected_behavior: body.expected_behavior || undefined,
    p_actual_behavior: body.actual_behavior || undefined,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    issue_number: issueNumber,
  }, { status: 201 });
}
