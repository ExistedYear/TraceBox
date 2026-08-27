import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import { findApiIssue } from "@/lib/api-github-issue";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Params = Promise<{ issueKey: string; linkId: string }>;

export async function DELETE(request: NextRequest, { params }: { params: Params }) {
  const auth = await authenticateApiRequest(request, "github_links:write");
  if ("response" in auth) return auth.response;
  const { issueKey, linkId } = await params;
  if (!UUID_RE.test(linkId)) return NextResponse.json({ error: "Invalid GitHub link ID." }, { status: 400 });
  const result = await findApiIssue(auth.client as any, auth.context, issueKey);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  const db = auth.client as any;
  const { data: link } = await db.from("issue_github_links").select("id").eq("id", linkId).eq("issue_id", result.issue.id).maybeSingle();
  if (!link) return NextResponse.json({ error: "GitHub link not found." }, { status: 404 });
  const { error } = await db.rpc("api_remove_github_link", { p_token_hash: auth.context.tokenHash, p_link_id: linkId });
  if (error) {
    console.error("GitHub API link deletion failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Could not remove GitHub link." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
