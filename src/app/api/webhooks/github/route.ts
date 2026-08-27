import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";

function isValidSignature(body: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const provided = Buffer.from(signature.slice(7), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}

function issueKeys(text: string) {
  return [...new Set(text.match(/[A-Z][A-Z0-9]{1,9}-\d+/g) ?? [])];
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const body = await request.text();
  if (!isValidSignature(body, request.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const event = request.headers.get("x-github-event");
  if (event !== "pull_request" && event !== "push") return NextResponse.json({ accepted: true, linked: 0 });
  const repository = typeof payload.repository?.full_name === "string" ? payload.repository.full_name : null;
  if (!repository) return NextResponse.json({ accepted: true, linked: 0 });

  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const source = event === "pull_request"
    ? `${payload.pull_request?.title ?? ""} ${payload.pull_request?.body ?? ""}`
    : `${payload.head_commit?.message ?? ""} ${commits.map((commit: any) => typeof commit?.message === "string" ? commit.message : "").join(" ")}`;
  const keys = issueKeys(source);
  const url = event === "pull_request" ? payload.pull_request?.html_url : payload.head_commit?.url;
  if (!keys.length || typeof url !== "string" || !/^https:\/\/github\.com\//i.test(url)) return NextResponse.json({ accepted: true, linked: 0 });

  const client = createAdminClient();
  const { data: integrations, error: integrationError } = await client.from("project_integrations").select("project_id").eq("provider", "GITHUB").eq("repo_full_name", repository).eq("is_enabled", true);
  if (integrationError) return NextResponse.json({ error: "Could not load GitHub integration." }, { status: 500 });

  let linked = 0;
  for (const integration of integrations ?? []) {
    const { data: project } = await client.from("projects").select("id, key").eq("id", integration.project_id).maybeSingle();
    if (!project) continue;
    for (const key of keys) {
      const separator = key.lastIndexOf("-");
      const prefix = key.slice(0, separator);
      const issueNumber = Number(key.slice(separator + 1));
      if (prefix !== project.key || !Number.isSafeInteger(issueNumber) || issueNumber < 1) continue;
      const { data: issue } = await client.from("issues").select("id").eq("project_id", project.id).eq("issue_number", issueNumber).maybeSingle();
      if (!issue) continue;
      try {
        const { data: linkId } = await client.rpc("record_github_webhook", {
          p_project_id: project.id,
          p_issue_id: issue.id,
          p_repo_name: repository,
          p_link_type: event === "pull_request" ? "PULL_REQUEST" : "COMMIT",
          p_url: url,
          p_title: event === "pull_request" ? payload.pull_request?.title : payload.head_commit?.message,
          p_status: event === "pull_request" ? (payload.pull_request?.merged ? "MERGED" : String(payload.pull_request?.state ?? "OPEN").toUpperCase()) : "OPEN",
          p_number: event === "pull_request" && Number.isSafeInteger(payload.pull_request?.number) ? payload.pull_request.number : null,
        });
        if (linkId) linked++;
      } catch {
        // Ignore one malformed reference while acknowledging the signed webhook.
      }
    }
  }
  return NextResponse.json({ accepted: true, linked });
}
