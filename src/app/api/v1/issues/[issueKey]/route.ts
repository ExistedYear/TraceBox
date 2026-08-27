import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseIssueKey } from "@/lib/issues";

type Params = Promise<{ issueKey: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { issueKey } = await params;
  const parsed = parseIssueKey(issueKey);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid issue key format (e.g. AUTH-42)" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("key", parsed.projectKey)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: issue, error } = await supabase
    .from("issues")
    .select("*, status:workflow_states(name, category), component:components(name)")
    .eq("project_id", project.id)
    .eq("issue_number", parsed.issueNumber)
    .maybeSingle();

  if (error || !issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  return NextResponse.json({ data: issue });
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { issueKey } = await params;
  const parsed = parseIssueKey(issueKey);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid issue key format" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("key", parsed.projectKey)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: issue } = await supabase
    .from("issues")
    .select("id")
    .eq("project_id", project.id)
    .eq("issue_number", parsed.issueNumber)
    .maybeSingle();

  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  let updates: any;
  try {
    updates = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { error } = await supabase.rpc("update_issue_fields", {
    p_issue_id: issue.id,
    p_updates: updates,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
