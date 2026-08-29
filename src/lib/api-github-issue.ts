import { filterApiVisibleIssues, type ApiTokenContext } from "@/lib/api-auth";
import { parseIssueKey } from "@/lib/issues";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type ApiDatabase = SupabaseClient<Database>;

export async function findApiIssue(client: ApiDatabase, context: ApiTokenContext, issueKey: string) {
  const parsed = parseIssueKey(issueKey);
  if (!parsed) return { error: "Invalid issue key format.", status: 400 } as const;

  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id, key, organization_id")
    .eq("key", parsed.projectKey)
    .eq("organization_id", context.organizationId)
    .eq("is_archived", false)
    .maybeSingle();
  if (projectError) return { error: "Could not load the project.", status: 500 } as const;
  if (!project) return { error: "Project not found.", status: 404 } as const;

  const { data: issue, error: issueError } = await client
    .from("issues")
    .select("id, project_id, visibility, reporter_id, assignee_id, issue_number")
    .eq("project_id", project.id)
    .eq("issue_number", parsed.issueNumber)
    .maybeSingle();
  if (issueError) return { error: "Could not load the issue.", status: 500 } as const;
  if (!issue) return { error: "Issue not found.", status: 404 } as const;

  let visibleIds: string[];
  try {
    visibleIds = await filterApiVisibleIssues(client, context, [issue]);
  } catch {
    return { error: "Could not verify issue access.", status: 500 } as const;
  }
  if (!visibleIds.includes(issue.id)) return { error: "Issue not found.", status: 404 } as const;
  return { project, issue, parsed, error: null } as const;
}
