import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getBlastRadius } from "@/features/intelligence/blast-radius";

export async function GET(request: NextRequest) {
  const issueId = request.nextUrl.searchParams.get("issueId");
  if (!issueId) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "issueId is required." }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Authentication required." }, { status: 401 });

  const { data: issue } = await supabase.from("issues").select("id, project_id, visibility").eq("id", issueId).maybeSingle();
  if (!issue) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Issue not found." }, { status: 404 });

  const canView = await supabase.rpc("can_view_issue" as never, { p_issue_id: issueId } as never);
  if (canView.error || !canView.data) return NextResponse.json({ code: "AI_DISABLED_FOR_RESTRICTED_ISSUE", message: "Not visible." }, { status: 403 });

  const projectId = (issue as { project_id: string }).project_id;

  const { data: links } = await supabase.from("issue_links").select("id, source_issue_id, target_issue_id, relationship").or(`source_issue_id.eq.${issueId},target_issue_id.eq.${issueId}`);
  const allLinks = ((links as Array<{ id: string; source_issue_id: string; target_issue_id: string; relationship: string }> | null) ?? []).slice();

  let fullLinks: Array<{ id: string; source_issue_id: string; target_issue_id: string; relationship: string }> = allLinks;
  try {
    const { data: projectIssues } = await supabase.from("issues").select("id").eq("project_id", projectId).limit(1000);
    const projectIssueIds = new Set(((projectIssues as Array<{ id: string }> | null) ?? []).map((row) => row.id));
    if (projectIssueIds.size > 0) {
      const ids = [...projectIssueIds].slice(0, 200);
      const { data: extraLinks } = await supabase.from("issue_links").select("id, source_issue_id, target_issue_id, relationship").in("source_issue_id", ids);
      const { data: extraLinks2 } = await supabase.from("issue_links").select("id, source_issue_id, target_issue_id, relationship").in("target_issue_id", ids);
      fullLinks = [...allLinks, ...((extraLinks as typeof allLinks) ?? []), ...((extraLinks2 as typeof allLinks) ?? [])];
      fullLinks = [...new Map(fullLinks.map((link) => [link.id, link])).values()];
    }
  } catch {
    fullLinks = allLinks;
  }

  const relatedIds = new Set<string>([issueId]);
  for (const link of fullLinks) {
    relatedIds.add(link.source_issue_id);
    relatedIds.add(link.target_issue_id);
  }

  const visibleIds = new Set<string>();
  for (const id of relatedIds) {
    const { data: canViewIssue } = await supabase.rpc("can_view_issue" as never, { p_issue_id: id } as never);
    if (canViewIssue) visibleIds.add(id);
  }

  const idsToFetch = [...visibleIds];
  let metaMap = new Map<string, { componentName?: string | null; milestoneId?: string | null; severity?: string | null; priority?: string | null; keyLabel?: string; title?: string; issueNumber?: number }>();
  if (idsToFetch.length > 0) {
    const { data: projectRow } = await supabase.from("projects").select("key").eq("id", projectId).maybeSingle();
    const projectKey = (projectRow as { key?: string } | null)?.key ?? "ISSUE";
    const { data: issues } = await supabase.from("issues").select("id, issue_number, title, severity, priority, component_id, target_milestone_id, component:components(name)").in("id", idsToFetch);
    const rows = (issues as Array<Record<string, unknown>> | null) ?? [];
    for (const row of rows) {
      const typed = row as { id: string; issue_number: number; title: string; severity: string; priority: string; target_milestone_id: string | null; component: { name: string } | null };
      metaMap.set(typed.id, {
        componentName: typed.component?.name ?? null,
        milestoneId: typed.target_milestone_id,
        severity: typed.severity,
        priority: typed.priority,
        keyLabel: `${projectKey}-${typed.issue_number}`,
        title: typed.title,
        issueNumber: typed.issue_number,
      });
    }
  }

  const result = getBlastRadius(issueId, fullLinks, metaMap, visibleIds, 5);

  return NextResponse.json({ data: result });
}
