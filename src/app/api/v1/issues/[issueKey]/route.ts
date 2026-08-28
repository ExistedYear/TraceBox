import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest, filterApiVisibleIssues, type ApiScope } from "@/lib/api-auth";
import { parseIssueKey } from "@/lib/issues";
import { issueUpdateSchema } from "@/lib/validation/issue-update";
import type { Json } from "@/types/database";

type Params = Promise<{ issueKey: string }>;

async function getIssue(request: NextRequest, issueKey: string, scope: ApiScope) {
  const auth = await authenticateApiRequest(request, scope);
  if ("response" in auth) return { auth: null, response: auth.response } as const;
  const parsed = parseIssueKey(issueKey);
  if (!parsed) return { auth: null, response: NextResponse.json({ error: "Invalid issue key format." }, { status: 400 }) } as const;
  const { data: project } = await auth.client.from("projects").select("id").eq("key", parsed.projectKey).eq("organization_id", auth.context.organizationId).eq("is_archived", false).maybeSingle();
  if (!project) return { auth: null, response: NextResponse.json({ error: "Project not found." }, { status: 404 }) } as const;
  const { data: issue, error } = await auth.client.from("issues").select("*").eq("project_id", project.id).eq("issue_number", parsed.issueNumber).maybeSingle();
  if (error || !issue) return { auth: null, response: NextResponse.json({ error: "Issue not found." }, { status: 404 }) } as const;
  const visibleIds = await filterApiVisibleIssues(auth.client, auth.context, [issue]);
  if (!visibleIds.includes(issue.id)) return { auth: null, response: NextResponse.json({ error: "Issue not found." }, { status: 404 }) } as const;
  return { auth, issue, response: null } as const;
}

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const result = await getIssue(request, (await params).issueKey, "issues:read");
  if (result.response) return result.response;
  const { data: issue, error } = await result.auth!.client.from("issues").select("*, status:workflow_states(name, category), component:components(name)").eq("id", result.issue.id).maybeSingle();
  if (error || !issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  return NextResponse.json({ data: issue });
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const result = await getIssue(request, (await params).issueKey, "issues:write");
  if (result.response) return result.response;
  let updates: unknown;
  try { updates = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) return NextResponse.json({ error: "JSON object body required." }, { status: 400 });
  const parsedUpdates = issueUpdateSchema.safeParse(updates);
  if (!parsedUpdates.success) return NextResponse.json({ error: "Unsupported or invalid update payload." }, { status: 422 });
  const { error } = await result.auth!.client.rpc("api_update_issue", { p_token_hash: result.auth!.context.tokenHash, p_issue_id: result.issue.id, p_updates: parsedUpdates.data as Json });
  if (error) return NextResponse.json({ error: "Could not update issue." }, { status: 400 });
  return NextResponse.json({ success: true });
}
