import { createGithubInstallationToken, getGithubPullRequest, GithubApiError, listGithubInstallationRepositories } from "@/lib/github-app";
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
    for (const repository of repositories) {
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
      if (error) {
        failed += 1;
        continue;
      }
      synced += 1;
      await reconcilePullRequestArtifacts(admin, token.token, repository);
    }
    const { data: previousRepositories } = await admin.from("github_repositories").select("github_repository_id").eq("installation_id", installation.id);
    for (const previous of previousRepositories ?? []) {
      if (!seen.has(previous.github_repository_id)) await admin.rpc("set_github_repository_access", { p_github_repository_id: previous.github_repository_id, p_is_accessible: false });
    }
    await admin.rpc("set_github_installation_status", { p_github_installation_id: installation.github_installation_id, p_status: "ACTIVE" });
    return { synced, failed, revoked: false };
  } catch (error) {
    if (error instanceof GithubApiError && (error.status === 401 || error.status === 404)) {
      await admin.rpc("set_github_installation_status", { p_github_installation_id: installation.github_installation_id, p_status: "REVOKED" });
      return { synced: 0, failed: 1, revoked: true };
    }
    if (error instanceof GithubApiError && error.status === 403) {
      await admin.rpc("set_github_installation_status", { p_github_installation_id: installation.github_installation_id, p_status: "NEEDS_PERMISSION_UPDATE" });
    }
    return { synced: 0, failed: 1, revoked: false };
  }
}

async function reconcilePullRequestArtifacts(admin: any, installationToken: string, repository: { id: number; owner: { login: string }; name: string; full_name: string }) {
  const { data: repositoryRow } = await admin.from("github_repositories").select("id").eq("github_repository_id", repository.id).maybeSingle();
  if (!repositoryRow) return;
  const { data: artifacts } = await admin.from("github_artifacts").select("id, number").eq("github_repository_id", repositoryRow.id).eq("artifact_type", "PULL_REQUEST").not("number", "is", null).limit(100);
  const { data: bindings } = await admin.from("project_github_repositories").select("project_id, auto_resolve_enabled, target_branches").eq("github_repository_id", repositoryRow.id);
  for (const artifact of artifacts ?? []) {
    if (!Number.isSafeInteger(artifact.number) || artifact.number < 1) continue;
    try {
      const pullRequest = await getGithubPullRequest(installationToken, repository.owner.login, repository.name, artifact.number);
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
        p_github_created_at: pullRequest.created_at,
        p_github_updated_at: pullRequest.updated_at,
      });
      if (error || !artifactId) continue;
      const { data: links } = await admin.from("issue_github_links").select("issue_id, relationship").eq("github_artifact_id", artifactId);
      for (const link of links ?? []) {
        await admin.rpc("link_github_artifact", { p_issue_id: link.issue_id, p_github_artifact_id: artifactId, p_relationship: link.relationship, p_source: "SYNC" });
        if (!pullRequest.merged_at || link.relationship !== "FIXES") continue;
        const { data: issue } = await admin.from("issues").select("project_id").eq("id", link.issue_id).maybeSingle();
        const binding = (bindings ?? []).find((candidate: { project_id: string; auto_resolve_enabled: boolean; target_branches: string[] }) => candidate.project_id === issue?.project_id);
        if (binding?.auto_resolve_enabled && typeof pullRequest.base?.ref === "string" && githubBranchMatches(pullRequest.base.ref, binding.target_branches ?? [])) {
          await admin.rpc("resolve_issue_from_github", { p_project_id: binding.project_id, p_issue_id: link.issue_id, p_github_repository_id: repositoryRow.id, p_target_branch: pullRequest.base.ref });
        }
      }
    } catch (error) {
      if (!(error instanceof GithubApiError && error.status === 404)) console.error("GitHub artifact reconciliation failed", { repository: repository.full_name, number: artifact.number, error: error instanceof Error ? error.message : "unknown" });
    }
  }
}
