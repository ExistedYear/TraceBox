import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { getBlastRadius } from "@/features/intelligence/blast-radius";
import { errorResponse, isUuid, jsonError } from "@/lib/ai/http";
import { AiError } from "@/lib/ai/errors";
export async function GET(request: NextRequest) {
  try {
    const issueId = request.nextUrl.searchParams.get("issueId"); if (!isUuid(issueId)) return jsonError("AI_CONTEXT_UNAVAILABLE", 400);
    const supabase = await createClient(); const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError && !isMissingAuthSession(authError)) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!auth.user) return jsonError("AI_CONTEXT_UNAVAILABLE", 401);
    const { data: issue, error: issueError } = await supabase.from("issues").select("id, project_id, visibility, type").eq("id", issueId).maybeSingle(); if (issueError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!issue) return jsonError("AI_CONTEXT_UNAVAILABLE", 404);
    const { data: rootVisible, error: accessError } = await supabase.rpc("can_view_issue", { p_issue_id: issueId }); if (accessError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!rootVisible) return jsonError("AI_NOT_AUTHORIZED");
    if ((issue as { visibility: string; type: string }).visibility === "RESTRICTED" || (issue as { visibility: string; type: string }).type === "SECURITY") return jsonError("AI_DISABLED_FOR_RESTRICTED_ISSUE");
    const projectId = String((issue as { project_id: string }).project_id);
    const { data: graphRows, error: graphError } = await supabase.rpc("get_issue_blast_radius_context", { p_issue_id: issueId, p_limit: 100 });
    if (graphError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const ids = new Set<string>([issueId]); for (const raw of ((graphRows as unknown) as Array<Record<string, unknown>> ?? [])) if (typeof raw.issue_id === "string") ids.add(raw.issue_id);
    const visible = ids;
    const { data: links, error: linksError } = await supabase.from("issue_links").select("id, source_issue_id, target_issue_id, relationship").in("source_issue_id", [...ids].slice(0, 100)).limit(200);
    const { data: reverseLinks, error: reverseLinksError } = await supabase.from("issue_links").select("id, source_issue_id, target_issue_id, relationship").in("target_issue_id", [...ids].slice(0, 100)).limit(200);
    if (linksError || reverseLinksError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const linkRows = [...((links ?? []) as Array<{ id: string; source_issue_id: string; target_issue_id: string; relationship: string }>), ...((reverseLinks ?? []) as Array<{ id: string; source_issue_id: string; target_issue_id: string; relationship: string }>)].filter((link, index, all) => all.findIndex((candidate) => candidate.id === link.id) === index);
    const { data: rows, error: rowsError } = await supabase.from("issues").select("id, issue_number, title, severity, priority, target_milestone_id, component:components(name)").eq("project_id", projectId).in("id", [...visible].slice(0, 200)); const { data: project, error: projectError } = await supabase.from("projects").select("key").eq("id", projectId).maybeSingle();
    if (rowsError || projectError || !project) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const meta = new Map<string, { issueNumber?: number; keyLabel?: string; title?: string; componentName?: string | null; milestoneId?: string | null; severity?: string | null; priority?: string | null }>();
    for (const raw of (rows ?? []) as Array<Record<string, unknown>>) { const component = raw.component as { name?: string } | null; meta.set(String(raw.id), { issueNumber: Number(raw.issue_number), keyLabel: `${String((project as { key: string }).key)}-${String(raw.issue_number)}`, title: typeof raw.title === "string" ? raw.title : undefined, componentName: component?.name ?? null, milestoneId: typeof raw.target_milestone_id === "string" ? raw.target_milestone_id : null, severity: typeof raw.severity === "string" ? raw.severity : null, priority: typeof raw.priority === "string" ? raw.priority : null }); }
    return NextResponse.json({ data: getBlastRadius(issueId, linkRows, meta, visible, 5, 200) });
  } catch (error) { return errorResponse(error); }
}
