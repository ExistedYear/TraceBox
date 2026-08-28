import { NextRequest, NextResponse } from "next/server";

import { authenticateApiRequest } from "@/lib/api-auth";
import { findApiIssue } from "@/lib/api-github-issue";
import { GITHUB_LINK_TYPES, GithubLinkValidationError, validateGithubLink } from "@/lib/github-link-validation";

type Params = Promise<{ issueKey: string }>;

async function readBody(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return {
      repoName: typeof body.repo_name === "string" ? body.repo_name : "",
      linkType: typeof body.link_type === "string" ? body.link_type : "",
      url: typeof body.url === "string" ? body.url : "",
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const auth = await authenticateApiRequest(request, "github_links:read");
  if ("response" in auth) return auth.response;
  const result = await findApiIssue(auth.client, auth.context, (await params).issueKey);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  const db = auth.client;
  const { data, error } = await db
    .from("issue_github_links")
    .select("id, repo_name, link_type, number, url, title, status, github_artifact_id, relationship, source, created_at")
    .eq("issue_id", result.issue.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load GitHub links." }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const auth = await authenticateApiRequest(request, "github_links:write");
  if ("response" in auth) return auth.response;
  const result = await findApiIssue(auth.client, auth.context, (await params).issueKey);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });

  const body = await readBody(request);
  if (!body || !body.repoName.trim() || !body.url.trim() || !GITHUB_LINK_TYPES.includes(body.linkType as (typeof GITHUB_LINK_TYPES)[number])) {
    return NextResponse.json({ error: "repo_name, link_type, and url are required." }, { status: 400 });
  }

  try {
    const verified = await validateGithubLink(auth.client, {
      projectId: result.issue.project_id,
      linkType: body.linkType,
      repoName: body.repoName,
      url: body.url,
    });
    const { data: id, error } = await auth.client.rpc("api_add_github_link", {
      p_token_hash: auth.context.tokenHash,
      p_issue_id: result.issue.id,
      p_repo_name: verified.repoName,
      p_link_type: body.linkType,
      p_url: verified.url,
      p_title: verified.title,
      p_status: verified.status,
      p_number: verified.number ?? undefined,
    });
    if (error || !id) {
      console.error("GitHub API link creation failed", { code: error?.code, message: error?.message });
      return NextResponse.json({ error: "Could not add GitHub link." }, { status: 400 });
    }
    return NextResponse.json({ data: { id, repo_name: verified.repoName, link_type: body.linkType, number: verified.number, url: verified.url, title: verified.title, status: verified.status } }, { status: 201 });
  } catch (error) {
    if (error instanceof GithubLinkValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("GitHub API link validation failed", { issueId: result.issue.id, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not verify that GitHub item." }, { status: 502 });
  }
}
