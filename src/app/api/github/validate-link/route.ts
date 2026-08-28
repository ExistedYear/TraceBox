import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { GithubLinkValidationError, validateGithubLink } from "@/lib/github-link-validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let body: { issue_id?: unknown; project_id?: unknown; link_type?: unknown; repo_name?: unknown; url?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const issueId = typeof body.issue_id === "string" ? body.issue_id : "";
  const projectId = typeof body.project_id === "string" ? body.project_id : "";
  const linkType = typeof body.link_type === "string" ? body.link_type : "";
  const repoName = typeof body.repo_name === "string" ? body.repo_name : "";
  const url = typeof body.url === "string" ? body.url : "";
  if (!UUID_RE.test(issueId) || !UUID_RE.test(projectId) || !linkType || !repoName || !url.trim()) return NextResponse.json({ error: "Issue, project, link type, repository, and URL are required." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: issue } = await supabase.from("issues").select("id, project_id").eq("id", issueId).eq("project_id", projectId).maybeSingle();
  if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  const { data: role } = await supabase.rpc("project_role", { p_project_id: issue.project_id });
  if (role !== "DEVELOPER" && role !== "MAINTAINER") return NextResponse.json({ error: "Only Developers and Maintainers can add GitHub links." }, { status: 403 });

  try {
    const result = await validateGithubLink(supabase, { projectId, linkType, repoName, url });
    return NextResponse.json({ repo_name: result.repoName, url: result.url, title: result.title, number: result.number, status: result.status });
  } catch (error) {
    if (error instanceof GithubLinkValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GitHub link validation failed", { issueId, linkType, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not verify that GitHub item." }, { status: 502 });
  }
}
