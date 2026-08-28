import { classifyGithubApiError, createGithubInstallationToken, getGithubPullRequest, getGithubPullRequestChecks, GithubApiError, invalidateGithubInstallationToken, listGithubInstallationRepositories, summarizeGithubChecks } from "@/lib/github-app";
import { githubBranchMatches } from "@/lib/github";

type Installation = { id: string; github_installation_id: number; status: string };

export async function syncGithubInstallation(admin: any, installation: Installation) {
  if (installation.status === "REVOKED" || installation.status === "SUSPENDED" || installation.status === "PENDING") return { synced: 0, failed: 0, revoked: false };
  try {
    const token = await createGithubInstallationToken(installation.github_installation_id);
    const repositories = await listGithubInstallationRepositories(token.token);
    const seen = new Set<number>();
    let synced = 0;
    let failed = 0;
    await mapWithConcurrency(repositories, 3, async (repository) => {
      seen.add(repository.id);
      const { error } = await admin.rpc("upsert_github_repository", {
        p_installation_id: installation.id,
        p_github_repository_id: repository.id,
        p_owner_login: repository.owner.login,
        p_name: repository.name,
        p_full_name: repository.full_name,
        p_private: repository.private,
        p_archived: repository.archived,
        p_default_branch: repository.default_branch,
        p_html_url: repository.html_url,
        p_is_accessible: true,
      });
      if (error) { failed += 1; return; }
      synced += 1;
      await reconcilePullRequestArtifacts(admin, token.token, repository, installation.github_installation_id);
    });
    const { data: previousRepositories } = await admin.from("github_repositories").select("github_repository_id").eq("installation_id", installation.id);
    for (const previous of previousRepositories ?? []) {
      if (!seen.has(previous.github_repository_id)) await admin.rpc("set_github_repository_access", { p_github_repository_id: previous.github_repository_id, p_is_accessible: false });
    }
    await admin.rpc("set_github_installation_status", { p_github_installation_id: installation.github_installation_id, p_status: "ACTIVE" });
    return { synced, failed, revoked: false };
  } catch (error) {
    if (error instanceof GithubApiError && classifyGithubApiError(error) === "AUTH_REVOKED") {
      invalidateGithubInstallationToken(installation.github_installation_id);
      await admin.rpc("set_github_installation_status", { p_github_installation_id: installation.github_installation_id, p_status: "REVOKED" });
      return { synced: 0, failed: 1, revoked: true };
    }
    if (error instanceof GithubApiError && classifyGithubApiError(error) === "PERMISSION_MISSING") {
      invalidateGithubInstallationToken(installation.github_installation_id);
      await admin.rpc("set_github_installation_status", { p_github_installation_id: installation.github_installation_id, p_status: "NEEDS_PERMISSION_UPDATE" });
    }
    return { synced: 0, failed: 1, revoked: false };
  }
}

async function reconcilePullRequestArtifacts(admin: any, installationToken: string, repository: { id: number; owner: { login: string }; name: string; full_name: string }, installationId: number) {
  const { data: repositoryRow } = await admin.from("github_repositories").select("id").eq("github_repository_id", repository.id).maybeSingle();
  if (!repositoryRow) return;
  const { data: artifacts } = await admin.from("github_artifacts").select("id, number, last_synced_at").eq("github_repository_id", repositoryRow.id).eq("artifact_type", "PULL_REQUEST").not("number", "is", null).order("last_synced_at", { ascending: true }).limit(100);
  const { data: bindings } = await admin.from("project_github_repositories").select("project_id, auto_resolve_enabled, target_branches").eq("github_repository_id", repositoryRow.id);
  await mapWithConcurrency(artifacts ?? [], 3, async (artifact: { id: string; number: number | null }) => {
    const pullRequestNumber = artifact.number;
    if (typeof pullRequestNumber !== "number" || !Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) return;
    try {
      const pullRequest = await getGithubPullRequest(installationToken, repository.owner.login, repository.name, pullRequestNumber);
      const { data: artifactId, error } = await admin.rpc("upsert_github_artifact", {
        p_github_repository_id: repositoryRow.id,
        p_artifact_type: "PULL_REQUEST",
        p_external_key: `pr:${artifact.number}`,
        p_github_id: pullRequest.id,
        p_github_node_id: pullRequest.node_id ?? null,
        p_number: pullRequest.number,
        p_title: pullRequest.title,
        p_html_url: pullRequest.html_url,
        p_state: pullRequest.state,
        p_draft: pullRequest.draft === true,
        p_merged: Boolean(pullRequest.merged_at),
        p_author_login: pullRequest.user?.login ?? null,
        p_head_sha: pullRequest.head?.sha ?? null,
        p_base_branch: pullRequest.base?.ref ?? null,
        p_head_branch: pullRequest.head?.ref ?? null,
        p_merge_commit_sha: pullRequest.merge_commit_sha ?? null,
        p_closed_at: pullRequest.closed_at ?? null,
        p_merged_at: pullRequest.merged_at ?? null,
        p_github_created_at: pullRequest.created_at,
        p_github_updated_at: pullRequest.updated_at,
      });
      if (error || !artifactId) return;
      if (pullRequest.head?.sha) {
        try {
          const summary = summarizeGithubChecks(await getGithubPullRequestChecks(installationToken, repository.owner.login, repository.name, pullRequest.head.sha));
          await admin.rpc("upsert_github_pr_check_summary", { p_github_artifact_id: artifactId, p_state: summary.state, p_total_count: summary.totalCount, p_completed_count: summary.completedCount, p_successful_count: summary.successfulCount, p_failed_count: summary.failedCount, p_pending_count: summary.pendingCount, p_checks: summary.checks, p_error: null });
        } catch (checkError) {
          if (checkError instanceof GithubApiError && (classifyGithubApiError(checkError) === "AUTH_REVOKED" || classifyGithubApiError(checkError) === "PERMISSION_MISSING")) invalidateGithubInstallationToken(installationId);
          console.error("GitHub check reconciliation failed", { repository: repository.full_name, number: pullRequestNumber, error: checkError instanceof Error ? checkError.message : "unknown" });
        }
      }
      const { data: links } = await admin.from("issue_github_links").select("issue_id, relationship, source").eq("github_artifact_id", artifactId);
      for (const link of links ?? []) {
        await admin.rpc("link_github_artifact", { p_issue_id: link.issue_id, p_github_artifact_id: artifactId, p_relationship: link.relationship, p_source: link.source === "AUTO_PARSED" ? "AUTO_PARSED" : link.source === "SYNC" ? "SYNC" : "MANUAL" });
        if (!pullRequest.merged_at || link.relationship !== "FIXES") continue;
        const { data: issue } = await admin.from("issues").select("project_id").eq("id", link.issue_id).maybeSingle();
        const binding = (bindings ?? []).find((candidate: { project_id: string; auto_resolve_enabled: boolean; target_branches: string[] }) => candidate.project_id === issue?.project_id);
        if (binding?.auto_resolve_enabled && typeof pullRequest.base?.ref === "string" && githubBranchMatches(pullRequest.base.ref, binding.target_branches ?? [])) {
          await admin.rpc("resolve_issue_from_github", { p_project_id: binding.project_id, p_issue_id: link.issue_id, p_github_repository_id: repositoryRow.id, p_target_branch: pullRequest.base.ref });
        }
      }
    } catch (error) {
      if (error instanceof GithubApiError && (classifyGithubApiError(error) === "AUTH_REVOKED" || classifyGithubApiError(error) === "PERMISSION_MISSING")) invalidateGithubInstallationToken(installationId);
      if (!(error instanceof GithubApiError && classifyGithubApiError(error) === "NOT_FOUND")) console.error("GitHub artifact reconciliation failed", { repository: repository.full_name, number: pullRequestNumber, error: error instanceof Error ? error.message : "unknown" });
    }
  });
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));
}
