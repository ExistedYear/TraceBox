import { createAdminClient } from "@/lib/api-auth";
import {
  classifyGithubApiError,
  createGithubInstallationToken,
  getGithubPullRequest,
  getGithubPullRequestChecks,
  invalidateGithubInstallationToken,
  summarizeGithubChecks,
  GithubApiError,
  type GithubPullRequestResponse,
} from "@/lib/github-app";
import { extractClosingIssueKeys, extractIssueKeys, githubBranchMatches, normalizeGithubRepository } from "@/lib/github";

export const MAX_GITHUB_WEBHOOK_ATTEMPTS = 8;

function githubUrl(value: unknown) {
  return typeof value === "string" && /^https:\/\/github\.com\//i.test(value) ? value : null;
}

function installationStatus(action: string | null) {
  if (action === "deleted") return "REVOKED";
  if (action === "suspend") return "SUSPENDED";
  if (action === "unsuspend" || action === "created" || action === "new_permissions_accepted") return "ACTIVE";
  return null;
}

async function syncRepository(db: any, installationId: string, repository: any, accessible = true) {
  if (!installationId || !repository || !Number.isSafeInteger(repository.id) || typeof repository.full_name !== "string") return;
  const { error } = await db.rpc("upsert_github_repository", {
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
  if (error) throw error;
}

async function processLifecycleEvent(db: any, payload: any, event: string, action: string | null) {
  const installationId = Number(payload.installation?.id);
  if (event === "installation" && Number.isSafeInteger(installationId) && installationId > 0) {
    const status = installationStatus(action);
    if (status) {
      const { error } = await db.rpc("set_github_installation_status", { p_github_installation_id: installationId, p_status: status });
      if (error) throw error;
    }
    return;
  }
  if (event === "installation_repositories" && Number.isSafeInteger(installationId) && installationId > 0) {
    const { data: installation, error: installationError } = await db.from("github_installations").select("id").eq("github_installation_id", installationId).maybeSingle();
    if (installationError) throw installationError;
    if (!installation) return;
    for (const repository of payload.repositories_added ?? []) await syncRepository(db, installation.id, repository, true);
    for (const repository of payload.repositories_removed ?? []) {
      if (Number.isSafeInteger(repository.id)) {
        const { error } = await db.rpc("set_github_repository_access", { p_github_repository_id: repository.id, p_is_accessible: false });
        if (error) throw error;
      }
    }
    return;
  }
  if (["repository", "installation_target"].includes(event) && Number.isSafeInteger(installationId) && installationId > 0) {
    const { data: installation, error: installationError } = await db.from("github_installations").select("id").eq("github_installation_id", installationId).maybeSingle();
    if (installationError) throw installationError;
    if (installation && payload.repository) await syncRepository(db, installation.id, payload.repository, action !== "deleted");
  }
}

function splitRepository(fullName: string) {
  const [owner, name] = fullName.split("/");
  return owner && name ? { owner, name } : null;
}

async function persistCheckSummary(db: any, artifactId: string, summary: ReturnType<typeof summarizeGithubChecks>, errorMessage: string | null = null) {
  const { error } = await db.rpc("upsert_github_pr_check_summary", {
    p_github_artifact_id: artifactId,
    p_state: summary.state,
    p_total_count: summary.totalCount,
    p_completed_count: summary.completedCount,
    p_successful_count: summary.successfulCount,
    p_failed_count: summary.failedCount,
    p_pending_count: summary.pendingCount,
    p_checks: summary.checks,
    p_error: errorMessage,
  });
  if (error) throw error;
}

function unavailableCheckSummary(): ReturnType<typeof summarizeGithubChecks> {
  return { state: "UNKNOWN", totalCount: 0, completedCount: 0, successfulCount: 0, failedCount: 0, pendingCount: 0, checks: [] };
}

async function saveCheckSummary(db: any, artifactId: string, fullName: string, headSha: string, token: string, installationId?: number) {
  const repository = splitRepository(fullName);
  if (!repository || !headSha) return;
  let summary: ReturnType<typeof summarizeGithubChecks>;
  let errorMessage: string | null = null;
  try {
    summary = summarizeGithubChecks(await getGithubPullRequestChecks(token, repository.owner, repository.name, headSha));
  } catch (error) {
    if (installationId && error instanceof GithubApiError && ["AUTH_REVOKED", "PERMISSION_MISSING"].includes(classifyGithubApiError(error))) {
      invalidateGithubInstallationToken(installationId);
    }
    errorMessage = "Could not load GitHub checks.";
    summary = unavailableCheckSummary();
  }
  await persistCheckSummary(db, artifactId, summary, errorMessage);
}

async function upsertPullRequest(db: any, repositoryId: string, pullRequest: GithubPullRequestResponse) {
  const url = githubUrl(pullRequest.html_url);
  if (!url || !Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1) return null;
  const { data: artifactId, error } = await db.rpc("upsert_github_artifact", {
    p_github_repository_id: repositoryId,
    p_artifact_type: "PULL_REQUEST",
    p_external_key: `pr:${pullRequest.number}`,
    p_github_id: Number.isSafeInteger(pullRequest.id) ? pullRequest.id : null,
    p_github_node_id: pullRequest.node_id ?? null,
    p_number: pullRequest.number,
    p_title: pullRequest.title ?? null,
    p_html_url: url,
    p_state: pullRequest.state ?? null,
    p_draft: pullRequest.draft === true,
    p_merged: pullRequest.merged === true || Boolean(pullRequest.merged_at),
    p_author_login: pullRequest.user?.login ?? null,
    p_head_sha: pullRequest.head?.sha ?? null,
    p_base_branch: pullRequest.base?.ref ?? null,
    p_head_branch: pullRequest.head?.ref ?? null,
    p_merge_commit_sha: pullRequest.merge_commit_sha ?? null,
    p_closed_at: pullRequest.closed_at ?? null,
    p_merged_at: pullRequest.merged_at ?? null,
    p_github_created_at: pullRequest.created_at ?? null,
    p_github_updated_at: pullRequest.updated_at ?? null,
  });
  if (error) throw error;
  if (!artifactId) throw new Error("GitHub artifact upsert returned no artifact id.");
  return String(artifactId);
}

async function processBoundEvent(db: any, payload: any, event: string, repositoryGithubId: number) {
  const { data: repository, error: repositoryError } = await db.from("github_repositories").select("id, full_name, installation_id").eq("github_repository_id", repositoryGithubId).maybeSingle();
  if (repositoryError) throw repositoryError;
  if (!repository) return { linked: 0, resolved: 0, hasBindings: false };
  const { data: bindings, error: bindingsError } = await db.from("project_github_repositories").select("project_id, auto_resolve_enabled, target_branches").eq("github_repository_id", repository.id);
  if (bindingsError) throw bindingsError;
  if (!bindings?.length) return { linked: 0, resolved: 0, hasBindings: false };
  const projectIds = bindings.map((binding: any) => binding.project_id);
  const { data: projects, error: projectsError } = await db.from("projects").select("id, key").in("id", projectIds).eq("is_archived", false);
  if (projectsError) throw projectsError;
  const projectMap = new Map<string, { id: string; key: string }>((projects ?? []).map((project: any) => [project.id, { id: project.id, key: String(project.key).toUpperCase() }]));
  let linked = 0;
  let resolved = 0;

  if (event === "pull_request") {
    const pullRequest = payload.pull_request as GithubPullRequestResponse & { merged?: boolean; body?: string | null };
    const artifactId = await upsertPullRequest(db, repository.id, pullRequest);
    if (!artifactId) return { linked, resolved, hasBindings: true };
    const { data: installation, error: installationError } = await db.from("github_installations").select("github_installation_id, status").eq("id", repository.installation_id).maybeSingle();
    if (installationError) throw installationError;
    if (pullRequest.head?.sha) {
      if (installation?.status === "ACTIVE") {
        try {
          const token = await createGithubInstallationToken(installation.github_installation_id);
          await saveCheckSummary(db, artifactId, repository.full_name, pullRequest.head.sha, token.token, installation.github_installation_id);
        } catch (error) {
          if (!(error instanceof GithubApiError)) throw error;
          if (["AUTH_REVOKED", "PERMISSION_MISSING"].includes(classifyGithubApiError(error))) invalidateGithubInstallationToken(installation.github_installation_id);
          await persistCheckSummary(db, artifactId, unavailableCheckSummary(), "Could not load GitHub checks.");
        }
      } else {
        await persistCheckSummary(db, artifactId, unavailableCheckSummary(), "The GitHub installation is not active.");
      }
    }
    const source = `${pullRequest.title ?? ""} ${pullRequest.body ?? ""}`;
    const keys = extractIssueKeys(source);
    const closingKeys = new Set(extractClosingIssueKeys(source));
    for (const binding of bindings) {
      const project = projectMap.get(binding.project_id);
      if (!project) continue;
      const desiredLinks: Array<{ issue_id: string; relationship: "FIXES" | "REFERENCES" }> = [];
      for (const key of keys) {
        const separator = key.lastIndexOf("-");
        const issueNumber = Number(key.slice(separator + 1));
        if (key.slice(0, separator) !== project.key || !Number.isSafeInteger(issueNumber) || issueNumber < 1) continue;
        const { data: issue, error: issueError } = await db.from("issues").select("id").eq("project_id", project.id).eq("issue_number", issueNumber).maybeSingle();
        if (issueError) throw issueError;
        if (issue) desiredLinks.push({ issue_id: issue.id, relationship: closingKeys.has(key) ? "FIXES" : "REFERENCES" });
      }
      const { data: reconciled, error: reconcileError } = await db.rpc("reconcile_auto_github_links", { p_project_id: project.id, p_github_artifact_id: artifactId, p_desired_links: desiredLinks });
      if (reconcileError) throw reconcileError;
      linked += Number(reconciled ?? 0);
      if (pullRequest.merged === true || Boolean(pullRequest.merged_at)) {
        for (const desired of desiredLinks.filter((link) => link.relationship === "FIXES")) {
          if (binding.auto_resolve_enabled && typeof pullRequest.base?.ref === "string" && githubBranchMatches(pullRequest.base.ref, binding.target_branches ?? [])) {
            const { data: didResolve, error: resolveError } = await db.rpc("resolve_issue_from_github", { p_project_id: project.id, p_issue_id: desired.issue_id, p_github_repository_id: repository.id, p_target_branch: pullRequest.base.ref });
            if (resolveError) throw resolveError;
            if (didResolve) resolved += 1;
          }
        }
      }
    }
    return { linked, resolved, hasBindings: true };
  }

  if (event === "check_run" || event === "check_suite" || event === "status") {
    const { data: installation, error: installationError } = await db.from("github_installations").select("github_installation_id, status").eq("id", repository.installation_id).maybeSingle();
    if (installationError) throw installationError;
    if (!installation || installation.status !== "ACTIVE") return { linked, resolved, hasBindings: true };
    const token = await createGithubInstallationToken(installation.github_installation_id);
    const pullRequestNumbers = new Set<number>();
    for (const pullRequest of payload.check_run?.pull_requests ?? []) if (Number.isSafeInteger(pullRequest?.number)) pullRequestNumbers.add(pullRequest.number);
    for (const pullRequest of payload.check_suite?.pull_requests ?? []) if (Number.isSafeInteger(pullRequest?.number)) pullRequestNumbers.add(pullRequest.number);
    if (typeof payload.check_suite?.head_sha === "string") {
      const { data: artifacts, error: artifactError } = await db.from("github_artifacts").select("number").eq("github_repository_id", repository.id).eq("artifact_type", "PULL_REQUEST").eq("head_sha", payload.check_suite.head_sha).not("number", "is", null);
      if (artifactError) throw artifactError;
      for (const artifact of artifacts ?? []) if (Number.isSafeInteger(artifact.number)) pullRequestNumbers.add(artifact.number);
    }
    if (typeof payload.sha === "string") {
      const { data: artifacts, error: artifactError } = await db.from("github_artifacts").select("number").eq("github_repository_id", repository.id).eq("head_sha", payload.sha).not("number", "is", null);
      if (artifactError) throw artifactError;
      for (const artifact of artifacts ?? []) if (Number.isSafeInteger(artifact.number)) pullRequestNumbers.add(artifact.number);
    }
    const repo = splitRepository(repository.full_name);
    if (repo) {
      for (const number of pullRequestNumbers) {
        const pullRequest = await getGithubPullRequest(token.token, repo.owner, repo.name, number);
        const artifactId = await upsertPullRequest(db, repository.id, pullRequest);
        if (artifactId && pullRequest.head?.sha) await saveCheckSummary(db, artifactId, repository.full_name, pullRequest.head.sha, token.token, installation.github_installation_id);
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
    if (artifactError) throw artifactError;
    if (!artifactId) throw new Error("GitHub commit artifact upsert returned no artifact id.");
    for (const binding of bindings) {
      const project = projectMap.get(binding.project_id);
      if (!project) continue;
      const desiredLinks: Array<{ issue_id: string; relationship: "REFERENCES" }> = [];
      for (const key of keys) {
        const separator = key.lastIndexOf("-");
        const issueNumber = Number(key.slice(separator + 1));
        if (key.slice(0, separator) !== project.key || !Number.isSafeInteger(issueNumber) || issueNumber < 1) continue;
        const { data: issue, error: issueError } = await db.from("issues").select("id").eq("project_id", project.id).eq("issue_number", issueNumber).maybeSingle();
        if (issueError) throw issueError;
        if (issue) desiredLinks.push({ issue_id: issue.id, relationship: "REFERENCES" });
      }
      const { data: reconciled, error } = await db.rpc("reconcile_auto_github_links", { p_project_id: project.id, p_github_artifact_id: artifactId, p_desired_links: desiredLinks });
      if (error) throw error;
      linked += Number(reconciled ?? 0);
    }
  }
  return { linked, resolved, hasBindings: true };
}

async function processLegacyEvent(db: any, payload: any, event: string, repositoryName: string) {
  const { data: integrations, error: integrationsError } = await db.from("project_integrations").select("project_id, auto_resolve_enabled").eq("provider", "GITHUB").ilike("repo_full_name", repositoryName).eq("is_enabled", true);
  if (integrationsError) throw integrationsError;
  if (!integrations?.length) return { linked: 0, resolved: 0 };
  const source = event === "pull_request" ? `${payload.pull_request?.title ?? ""} ${payload.pull_request?.body ?? ""}` : `${payload.head_commit?.message ?? ""} ${(payload.commits ?? []).map((commit: any) => typeof commit?.message === "string" ? commit.message : "").join(" ")}`;
  const keys = extractIssueKeys(source);
  const closingKeys = new Set(extractClosingIssueKeys(source));
  const headCommitSha = typeof payload.head_commit?.id === "string" ? payload.head_commit.id : null;
  const url = event === "pull_request" ? githubUrl(payload.pull_request?.html_url) : githubUrl(payload.head_commit?.html_url) ?? (headCommitSha ? `https://github.com/${repositoryName}/commit/${headCommitSha}` : null);
  if (!keys.length || !url) return { linked: 0, resolved: 0 };
  let linked = 0;
  let resolved = 0;
  for (const integration of integrations) {
    const { data: project, error: projectError } = await db.from("projects").select("id, key").eq("id", integration.project_id).eq("is_archived", false).maybeSingle();
    if (projectError) throw projectError;
    if (!project) continue;
    for (const key of keys) {
      const separator = key.lastIndexOf("-");
      const issueNumber = Number(key.slice(separator + 1));
      if (key.slice(0, separator) !== String(project.key).toUpperCase() || !Number.isSafeInteger(issueNumber) || issueNumber < 1) continue;
      const { data: issue, error: issueError } = await db.from("issues").select("id").eq("project_id", project.id).eq("issue_number", issueNumber).maybeSingle();
      if (issueError) throw issueError;
      if (!issue) continue;
      const { data: linkId, error } = await db.rpc("record_github_webhook", { p_project_id: project.id, p_issue_id: issue.id, p_repo_name: repositoryName, p_link_type: event === "pull_request" ? "PULL_REQUEST" : "COMMIT", p_url: url, p_title: event === "pull_request" ? payload.pull_request?.title : payload.head_commit?.message, p_status: event === "pull_request" ? (payload.pull_request?.merged ? "MERGED" : String(payload.pull_request?.state ?? "OPEN").toUpperCase()) : "OPEN", p_number: event === "pull_request" && Number.isSafeInteger(payload.pull_request?.number) ? payload.pull_request.number : null });
      if (error) throw error;
      if (!linkId) throw new Error("Legacy GitHub link recorder returned no link id.");
      linked += 1;
      if (event === "pull_request" && payload.pull_request?.merged === true && integration.auto_resolve_enabled && closingKeys.has(key)) {
        const { data: didResolve, error: resolveError } = await db.rpc("resolve_issue_from_github", { p_project_id: project.id, p_issue_id: issue.id, p_repo_name: repositoryName });
        if (resolveError) throw resolveError;
        if (didResolve) resolved += 1;
      }
    }
  }
  return { linked, resolved };
}

export async function processGithubWebhookPayload(db: any, payload: any, event: string, action: string | null) {
  if (["installation", "installation_repositories", "repository", "installation_target"].includes(event)) {
    await processLifecycleEvent(db, payload, event, action);
    return { linked: 0, resolved: 0 };
  }
  if (!["pull_request", "push", "check_run", "check_suite", "status"].includes(event)) return { linked: 0, resolved: 0 };
  const repositoryId = Number(payload.repository?.id);
  const normalizedRepository = typeof payload.repository?.full_name === "string" ? normalizeGithubRepository(payload.repository.full_name) : null;
  if (!normalizedRepository || !Number.isSafeInteger(repositoryId) || repositoryId < 1) return { linked: 0, resolved: 0 };
  const result = await processBoundEvent(db, payload, event, repositoryId);
  const legacy = result.hasBindings ? { linked: 0, resolved: 0 } : event === "pull_request" || event === "push" ? await processLegacyEvent(db, payload, event, normalizedRepository) : { linked: 0, resolved: 0 };
  return { linked: result.linked + legacy.linked, resolved: result.resolved + legacy.resolved };
}

function retryDelay(attemptCount: number) {
  return Math.min(24 * 60 * 60, 60 * 2 ** Math.max(attemptCount - 1, 0));
}

export async function processGithubWebhookDelivery(deliveryId: string) {
  const admin = createAdminClient() as any;
  const { data: claimed, error: claimError } = await admin.rpc("claim_github_webhook_delivery", { p_delivery_id: deliveryId, p_lease_seconds: 300 });
  if (claimError || !claimed) return false;
  const { data: delivery, error: deliveryError } = await admin.from("github_webhook_deliveries").select("delivery_id, event_name, action, payload, attempt_count").eq("delivery_id", deliveryId).maybeSingle();
  if (deliveryError || !delivery) return false;
  try {
    const result = await processGithubWebhookPayload(admin, delivery.payload ?? {}, delivery.event_name, delivery.action);
    const { error } = await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "PROCESSED", p_error: null, p_retry_at: null });
    if (error) throw error;
    console.info("GitHub webhook processed", { deliveryId, linked: result.linked, resolved: result.resolved, attempt: delivery.attempt_count });
    return true;
  } catch (error) {
    const attempt = Number(delivery.attempt_count ?? 1);
    const installationId = Number(delivery.payload?.installation?.id);
    const kind = error instanceof GithubApiError ? classifyGithubApiError(error) : "UNKNOWN";
    if (Number.isSafeInteger(installationId) && installationId > 0 && ["AUTH_REVOKED", "PERMISSION_MISSING"].includes(kind)) invalidateGithubInstallationToken(installationId);
    const retryAt = attempt >= MAX_GITHUB_WEBHOOK_ATTEMPTS ? null : new Date(Date.now() + retryDelay(attempt) * 1000).toISOString();
    console.error("GitHub webhook processing failed", { deliveryId, event: delivery.event_name, error: error instanceof Error ? error.message : "unknown" });
    await admin.rpc("mark_github_webhook_delivery", { p_delivery_id: deliveryId, p_status: "FAILED", p_error: "Processing failed; TraceBox will retry.", p_retry_at: retryAt });
    return false;
  }
}
