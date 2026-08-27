import { filterApiVisibleIssues, type ApiTokenContext } from "@/lib/api-auth";
import { parseIssueKey } from "@/lib/issues";

type ApiDatabase = {
  from: (table: string) => any;
};

export async function findApiIssue(client: ApiDatabase, context: ApiTokenContext, issueKey: string) {
  const parsed = parseIssueKey(issueKey);
  if (!parsed) return { error: "Invalid issue key format.", status: 400 } as const;

  const { data: project } = await client
    .from("projects")
    .select("id, key, organization_id")
    .eq("key", parsed.projectKey)
    .eq("organization_id", context.organizationId)
    .eq("is_archived", false)
    .maybeSingle();
  if (!project) return { error: "Project not found.", status: 404 } as const;

  const { data: issue } = await client
    .from("issues")
    .select("id, project_id, visibility, reporter_id, assignee_id, issue_number")
    .eq("project_id", project.id)
    .eq("issue_number", parsed.issueNumber)
    .maybeSingle();
  if (!issue) return { error: "Issue not found.", status: 404 } as const;

  const visibleIds = await filterApiVisibleIssues(client as any, context, [issue]);
  if (!visibleIds.includes(issue.id)) return { error: "Issue not found.", status: 404 } as const;
  return { project, issue, parsed, error: null } as const;
}
