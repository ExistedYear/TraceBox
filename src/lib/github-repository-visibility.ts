export type GithubRepositoryVisibilityInstallation = { id: string };

export type GithubRepositoryVisibilityRepository = { id: string; installation_id: string };

export type GithubRepositoryVisibilityBinding = { github_repository_id: string };

/**
 * Keep the organization-wide GitHub catalog behind the maintainer boundary.
 * Developers can only see repositories already bound to the requested project,
 * and only installations that own one of those visible repositories.
 */
export function scopeGithubRepositoryCatalog<
  TInstallation extends GithubRepositoryVisibilityInstallation,
  TRepository extends GithubRepositoryVisibilityRepository,
  TBinding extends GithubRepositoryVisibilityBinding,
>(input: {
  role: string | null | undefined;
  installations: TInstallation[];
  repositories: TRepository[];
  bindings: TBinding[];
}) {
  if (input.role === "MAINTAINER") return input;

  const boundRepositoryIds = new Set(input.bindings.map((binding) => binding.github_repository_id));
  const repositories = input.repositories.filter((repository) => boundRepositoryIds.has(repository.id));
  const installationIds = new Set(repositories.map((repository) => repository.installation_id));
  const installations = input.installations.filter((installation) => installationIds.has(installation.id));
  return { ...input, installations, repositories };
}
