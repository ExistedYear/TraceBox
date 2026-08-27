import { createGithubInstallationToken, getGithubBranch, getGithubCommit, getGithubPullRequest, getGithubRepository, GithubApiError } from "@/lib/github-app";
import { normalizeGithubRepository } from "@/lib/github";

export const GITHUB_LINK_TYPES = ["PULL_REQUEST", "COMMIT", "BRANCH"] as const;
export type GithubLinkType = (typeof GITHUB_LINK_TYPES)[number];

export class GithubLinkValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GithubLinkValidationError";
    this.status = status;
  }
}

export async function validateGithubLink(db: any, input: { projectId: string; linkType: string; repoName: string; url: string }) {
  const requestedRepository = normalizeGithubRepository(input.repoName);
  if (!requestedRepository || !GITHUB_LINK_TYPES.includes(input.linkType as GithubLinkType)) throw new GithubLinkValidationError("Repository and link type are invalid.");
  let parsedUrl: URL;
  try { parsedUrl = new URL(input.url.trim()); } catch { throw new GithubLinkValidationError("Enter a valid GitHub URL."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.toLowerCase() !== "github.com") throw new GithubLinkValidationError("Only github.com URLs are supported.");
  const segments = parsedUrl.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments.length < 3) throw new GithubLinkValidationError("The GitHub URL is missing repository details.");
  const owner = segments[0] ?? "";
  const repositoryName = segments[1] ?? "";
  const repositoryFullName = `${owner}/${repositoryName}`.toLowerCase();
  if (requestedRepository !== repositoryFullName) throw new GithubLinkValidationError("Repository must match the GitHub URL.");

  const { data: bindings } = await db.from("project_github_repositories").select("github_repository_id").eq("project_id", input.projectId);
  const repositoryIds = (bindings ?? []).map((binding: { github_repository_id: string }) => binding.github_repository_id);
  const { data: connectedRepositories } = repositoryIds.length ? await db.from("github_repositories").select("id, installation_id, full_name, private, is_accessible").in("id", repositoryIds) : { data: [] };
  const connectedRepository = (connectedRepositories ?? []).find((repository: { full_name: string; is_accessible: boolean }) => repository.full_name.toLowerCase() === repositoryFullName && repository.is_accessible);
  let installationToken: string | null = null;
  if (connectedRepository) {
    const { data: installation } = await db.from("github_installations").select("github_installation_id, status").eq("id", connectedRepository.installation_id).maybeSingle();
    if (installation?.status !== "ACTIVE") throw new GithubLinkValidationError("The connected GitHub installation is not active.", 409);
    const token = await createGithubInstallationToken(installation.github_installation_id);
    installationToken = token.token;
  }

  try {
    const repository = await getGithubRepository(installationToken, owner, repositoryName);
    if (!connectedRepository && repository.private) throw new GithubLinkValidationError("This private repository is not connected to the project.", 403);
    if (input.linkType === "PULL_REQUEST") {
      if (segments[2] !== "pull" || !/^\d+$/.test(segments[3] ?? "")) throw new GithubLinkValidationError("Use a GitHub pull request URL.");
      const pullRequest = await getGithubPullRequest(installationToken, owner, repositoryName, Number(segments[3]));
      return { repoName: repository.full_name, url: pullRequest.html_url, title: pullRequest.title, number: pullRequest.number, status: pullRequest.merged_at ? "MERGED" : pullRequest.draft ? "DRAFT" : pullRequest.state.toUpperCase() };
    }
    if (input.linkType === "COMMIT") {
      if (segments[2] !== "commit" || !segments[3]) throw new GithubLinkValidationError("Use a GitHub commit URL.");
      const commit = await getGithubCommit(installationToken, owner, repositoryName, segments[3]);
      return { repoName: repository.full_name, url: commit.html_url, title: commit.commit?.message?.split("\n")[0] ?? commit.sha.slice(0, 12), number: null, status: "OPEN" };
    }
    if (segments[2] !== "tree" || !segments.slice(3).length) throw new GithubLinkValidationError("Use a GitHub branch URL.");
    const branch = segments.slice(3).join("/");
    await getGithubBranch(installationToken, owner, repositoryName, branch);
    return { repoName: repository.full_name, url: input.url.trim(), title: branch, number: null, status: "OPEN" };
  } catch (error) {
    if (error instanceof GithubLinkValidationError) throw error;
    if (error instanceof GithubApiError && error.status === 404) throw new GithubLinkValidationError("GitHub could not find that repository or item.", 404);
    throw new GithubLinkValidationError("Could not verify that GitHub item.", 502);
  }
}
