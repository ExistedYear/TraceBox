import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, filterApiVisibleIssues } from "@/lib/api-auth";
import { parseIssueKey } from "@/lib/issues";
import { commentSchema } from "@/lib/validation/comment";

type Params = Promise<{ issueKey: string }>;

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const auth = await authenticateApiRequest(request, "comments:write");
  if ("response" in auth) return auth.response;
  const parsedKey = parseIssueKey((await params).issueKey);
  if (!parsedKey) return NextResponse.json({ error: "Invalid issue key format." }, { status: 400 });
  const { data: project } = await auth.client.from("projects").select("id").eq("organization_id", auth.context.organizationId).eq("key", parsedKey.projectKey).eq("is_archived", false).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const { data: issue } = await auth.client.from("issues").select("id, project_id, visibility, reporter_id, assignee_id").eq("project_id", project.id).eq("issue_number", parsedKey.issueNumber).maybeSingle();
  if (!issue || !(await filterApiVisibleIssues(auth.client, auth.context, [issue])).length) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Comment body must be 1-10,000 characters." }, { status: 422 });
  const { data, error } = await auth.client.rpc("api_add_comment", { p_token_hash: auth.context.tokenHash, p_issue_id: issue.id, p_body: parsed.data.body });
  if (error) return NextResponse.json({ error: "Could not add comment." }, { status: 400 });
  return NextResponse.json({ success: true, id: data }, { status: 201 });
}
