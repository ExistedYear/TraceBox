import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";
import { extractClosingIssueKeys, extractIssueKeys, githubBranchMatches, normalizeGithubRepository } from "@/lib/github";

function isValidSignature(body: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const provided = Buffer.from(signature.slice(7), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}

function githubUrl(value: unknown) {
  return typeof value === "string" && /^https:\/\/github\.com\//i.test(value) ? value : null;
}

function installationStatus(action: string | null) {
  if (action === "deleted") return "REVOKED";
  if (action === "suspend") return "SUSPENDED";
  if (action === "unsuspend" || action === "created" || action === "new_permissions_accepted") return "ACTIVE";
  return null;
}

async function syncRepository(db: any, installationId: any, repository: any, accessible = true) {
  if (!installationId || !repository || !Number.isSafeInteger(repository.id) || typeof repository.full_name !== "string") return;
  await db.rpc("upsert_github_repository", {
    p_installation_id: installationId,
    p_github_repository_id: repository.id,
    p_owner_login: repository.owner?.login ?? repository.full_name.split("/")[0],
    p_name: repository.name ?? repository.full_name.split("/").at(-1),
    p_full_name: repository.full_name,
    p_private: repository.private === true,
    p_archived: repository.archived === true,
    p_default_branch: repository.default_branch ?? null,
    p_html_url: repository.html_url ?? `https://github.com/${repository.full_name}`,
    p_is_accessible: accessible,
  });
}

async function processLifecycleEvent(db: any, payload: any, event: string, action: string | null) {
  const installationId = Number(payload.installation?.id);
  if (event === "installation" && Number.isSafeInteger(installationId) && installationId > 0) {
    const status = installationStatus(action);
    if (status) await db.rpc("set_github_installation_status", { p_github_installation_id: installationId, p_status: status });
    return;
  }
  if (event === "installation_repositories" && Number.isSafeInteger(installationId) && installationId > 0) {
    const { data: installation } = await db.from("github_installations").select("id").eq("github_installation_id", installationId).maybeSingle();
    if (!installation) return;
    for (const repository of payload.repositories_added ?? []) await syncRepository(db, installation.id, repository, true);
    for (const repository of payload.repositories_removed ?? []) {
      if (Number.isSafeInteger(repository.id)) await db.rpc("set_github_repository_access", { p_github_repository_id: repository.id, p_is_accessible: false });
    }
    return;
  }
  if (event === "repository" && Number.isSafeInteger(installationId) && installationId > 0) {
    const { data: installation } = await db.from("github_installations").select("id").eq("github_installation_id", installationId).maybeSingle();
    if (installation) await syncRepository(db, installation.id, payload.repository, action !== "deleted");
  }
}

async function processBoundEvent(db: any, payload: any, event: string, repositoryGithubId: number) {
  const { data: repository } = await db.from("github_repositories").select("id, full_name").eq("github_repository_id", repositoryGithubId).maybeSingle();
  if (!repository) return { linked: 0, resolved: 0, hasBindings: false };
  const { data: bindings } = await db.from("project_github_repositories").select("project_id, auto_resolve_enabled, target_branches").eq("github_repository_id", repository.id);
  if (!bindings?.length) return { linked: 0, resolved: 0, hasBindings: false };
  const projectIds = bindings.map((binding: any) => binding.project_id);
  const { data: projects } = await db.from("projects").select("id, key").in("id", projectIds).eq("is_archived", false);
  const projectMap = new Map<string, { id: string; key: string }>((projects ?? []).map((project: any) => [project.id, { id: project.id, key: project.key }]));
  let linked = 0;
  let resolved = 0;

  if (event === "pull_request") {
    const pullRequest = payload.pull_request;
    const url = githubUrl(pullRequest?.html_url);
    const number = Number(pullRequest?.number);
    if (!url || !Number.isSafeInteger(number) || number < 1) return { linked, resolved, hasBindings: true };
    const source = `${pullRequest?.title ?? ""} ${pullRequest?.body ?? ""}`;
    const keys = extractIssueKeys(source);
    const closingKeys = new Set(extractClosingIssueKeys(source));
    const { data: artifactId, error: artifactError } = await db.rpc("upsert_github_artifact", {
      p_github_repository_id: repository.id,
      p_artifact_type: "PULL_REQUEST",
      p_external_key: `pr:${number}`,
      p_github_id: Number.isSafeInteger(pullRequest?.id) ? pullRequest.id : null,
      p_github_node_id: pullRequest?.node_id ?? null,
      p_number: number,
      p_title: pullRequest?.title ?? null,
      p_html_url: url,
      p_state: pullRequest?.state ?? null,
      p_draft: pullRequest?.draft === true,
      p_merged: pullRequest?.merged === true || Boolean(pullRequest?.merged_at),
      p_author_login: pullRequest?.user?.login ?? null,
      p_head_sha: pullRequest?.head?.sha ?? null,
      p_base_branch: pullRequest?.base?.ref ?? null,
      p_github_created_at: pullRequest?.created_at ?? null,
      p_github_updated_at: pullRequest?.updated_at ?? null,
    });
    if (artifactError || !artifactId) return { linked, resolved, hasBindings: true };
    for (const binding of bindings) {
      const project = projectMap.get(binding.project_id);
      if (!project) continue;
      for (const key of keys) {
        const separator = key.lastIndexOf("-");
        const prefix = key.slice(0, separator);
        const issueNumber = Number(key.slice(separator + 1));
        if (prefix !== project.key || !Number.isSafeInteger(issueNumber) || issueNumber < 1) continue;
        const { data: issue } = await db.from("issues").select("id").eq("project_id", project.id).eq("issue_number", issueNumber).maybeSingle();
        if (!issue) continue;
        const relationship = closingKeys.has(key) ? "FIXES" : "REFERENCES";
        const { error: linkError } = await db.rpc("link_github_artifact", { p_issue_id: issue.id, p_github_artifact_id: artifactId, p_relationship: relationship, p_source: "AUTO_PARSED" });
        if (!linkError) linked += 1;
        if (pullRequest?.merged === true && relationship === "FIXES" && binding.auto_resolve_enabled && Array.isArray(binding.target_branches) && typeof pullRequest?.base?.ref === "string" && githubBranchMatches(pullRequest.base.ref, binding.target_branches)) {
          const { data: didResolve, error: resolveError } = await db.rpc("resolve_issue_from_github", { p_project_id: project.id, p_issue_id: issue.id, p_github_repository_id: repository.id, p_target_branch: pullRequest.base.ref });
          if (!resolveError && didResolve) resolved += 1;
        }
      }
    }
    return { linked, resolved, hasBindings: true };
  }

  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const candidates = commits.length ? commits : payload.head_commit ? [payload.head_commit] : [];
  for (const commit of candidates) {
    const sha = typeof commit?.id === "string" ? commit.id : null;
    const url = githubUrl(commit?.html_url) ?? (sha ? `https://github.com/${repository.full_name}/commit/${sha}` : null);
    if (!sha || !url) continue;
    const keys = extractIssueKeys(typeof commit.message === "string" ? commit.message : "");
    if (!keys.length) continue;
    const { data: artifactId, error: artifactError } = await db.rpc("upsert_github_artifact", {
      p_github_repository_id: repository.id,
      p_artifact_type: "COMMIT",
      p_external_key: `sha:${sha}`,
      p_github_id: null,
      p_sha: sha,
      p_title: commit.message ?? null,
      p_html_url: url,
      p_author_login: commit.author?.username ?? commit.author?.name ?? null,
      p_github_created_at: commit.timestamp ?? null,
      p_github_updated_at: commit.timestamp ?? null,
    });
    if (artifactError || !artifactId) continue;
    for (const binding of bindings) {
      const project = projectMap.get(binding.project_id);
      if (!project) continue;
      for (const key of keys) {
        const separator = key.lastIndexOf("-");
        const issueNumber = Number(key.slice(separator + 1));
        if (key.slice(0, separator) !== project.key || !Number.isSafeInteger(issueNumber) || issueNumber < 1) continue;
        const { data: issue } = await db.from("issues").select("id").eq("project_id", project.id).eq("issue_number", issueNumber).maybeSingle();
        if (!issue) continue;
        const { error: linkError } = await db.rpc("link_github_artifact", { p_issue_id: issue.id, p_github_artifact_id: artifactId, p_relationship: "REFERENCES", p_source: "AUTO_PARSED" });
        if (!linkError) linked += 1;
      }
    }
  }
  return { linked, resolved, hasBindings: true };
}

async function processLegacyEvent(db: any, payload: any, event: string, repositoryName: string) {
  const { data: integrations } = await db.from("project_integrations").select("project_id, auto_resolve_enabled").eq("provider", "GITHUB").ilike("repo_full_name", repositoryName).eq("is_enabled", true);
  if (!integrations?.length) return { linked: 0, resolved: 0 };
  const source = event === "pull_request"
    ? `${payload.pull_request?.title ?? ""} ${payload.pull_request?.body ?? ""}`
    : `${payload.head_commit?.message ?? ""} ${(payload.commits ?? []).map((commit: any) => typeof commit?.message === "string" ? commit.message : "").join(" ")}`;
  const keys = extractIssueKeys(source);
  const closingKeys = new Set(extractClosingIssueKeys(source));
  const headCommitSha = typeof payload.head_commit?.id === "string" ? payload.head_commit.id : null;
  const url = event === "pull_request" ? githubUrl(payload.pull_request?.html_url) : githubUrl(payload.head_commit?.html_url) ?? (headCommitSha ? `https://github.com/${repositoryName}/commit/${headCommitSha}` : null);
  if (!keys.length || !url) return { linked: 0, resolved: 0 };
  let linked = 0;
  let resolved = 0;
  for (const integration of integrations) {
    const { data: project } = await db.from("projects").select("id, key").eq("id", integration.project_id).eq("is_archived", false).maybeSingle();
    if (!project) continue;
    for (const key of keys) {
      const separator = key.lastIndexOf("-");
      const issueNumber = Number(key.slice(separator + 1));
      if (key.slice(0, separator) !== project.key || !Number.isSafeInteger(issueNumber) || issueNumber < 1) continue;
      const { data: issue } = await db.from("issues").select("id").eq("project_id", project.id).eq("issue_number", issueNumber).maybeSingle();
      if (!issue) continue;
      const { data: linkId, error } = await db.rpc("record_github_webhook", {
        p_project_id: project.id,
        p_issue_id: issue.id,
        p_repo_name: repositoryName,
        p_link_type: event === "pull_request" ? "PULL_REQUEST" : "COMMIT",
        p_url: url,
        p_title: event === "pull_request" ? payload.pull_request?.title : payload.head_commit?.message,
        p_status: event === "pull_request" ? (payload.pull_request?.merged ? "MERGED" : String(payload.pull_request?.state ?? "OPEN").toUpperCase()) : "OPEN",
        p_number: event === "pull_request" && Number.isSafeInteger(payload.pull_request?.number) ? payload.pull_request.number : null,
      });
      if (!error && linkId) linked += 1;
      if (event === "pull_request" && payload.pull_request?.merged === true && integration.auto_resolve_enabled && closingKeys.has(key)) {
        const { data: didResolve, error: resolveError } = await db.rpc("resolve_issue_from_github", { p_project_id: project.id, p_issue_id: issue.id, p_repo_name: repositoryName });
        if (!resolveError && didResolve) resolved += 1;
      }
    }
  }
  return { linked, resolved };
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const body = await request.text();
  if (!isValidSignature(body, request.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  if (!deliveryId || !event) return NextResponse.json({ error: "Missing GitHub webhook headers." }, { status: 400 });

  let payload: any;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const action = typeof payload.action === "string" ? payload.action : null;
  const repositoryId = Number(payload.repository?.id);
  const installationId = Number(payload.installation?.id);
  const admin = createAdminClient() as any;
  const { data: delivery, error: deliveryError } = await admin.rpc("record_github_webhook_delivery", {
    p_delivery_id: deliveryId,
    p_event_name: event,
    p_action: action,
    p_github_installation_id: Number.isSafeInteger(installationId) ? installationId : null,
    p_github_repository_id: Number.isSafeInteger(repositoryId) ? repositoryId : null,
    p_payload: payload,
  });
  if (deliveryError) return NextResponse.json({ error: "Could not record webhook delivery." }, { status: 500 });
  if (!delivery) return NextResponse.json({ accepted: true, duplicate: true, linked: 0, resolved: 0 });

  after(async () => {
    try {
      await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "PROCESSING" });
      if (["installation", "installation_repositories", "repository"].includes(event)) {
        await processLifecycleEvent(admin, payload, event, action);
        await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "PROCESSED" });
        return;
      }
      if (event !== "pull_request" && event !== "push") {
        await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "IGNORED" });
        return;
      }
      const normalizedRepository = typeof payload.repository?.full_name === "string" ? normalizeGithubRepository(payload.repository.full_name) : null;
      if (!normalizedRepository || !Number.isSafeInteger(repositoryId) || repositoryId < 1) {
        await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "IGNORED" });
        return;
      }
      const result = await processBoundEvent(admin, payload, event, repositoryId);
      const legacy = result.hasBindings ? { linked: 0, resolved: 0 } : await processLegacyEvent(admin, payload, event, normalizedRepository);
      await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "PROCESSED" });
      console.info("GitHub webhook processed", { deliveryId, linked: result.linked + legacy.linked, resolved: result.resolved + legacy.resolved });
    } catch (error) {
      console.error("GitHub webhook processing failed", { deliveryId, event, error: error instanceof Error ? error.message : "unknown" });
      await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "FAILED", p_error: "Processing failed." });
    }
  });
  return NextResponse.json({ accepted: true, queued: true });
}
