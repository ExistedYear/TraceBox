import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { AI_MODEL } from "@/lib/ai/config";
import { groqJson } from "@/lib/ai/client";
import { AiError } from "@/lib/ai/errors";
import { canonicalHash } from "@/lib/ai/hash";
import { redactObject } from "@/lib/ai/redact";
import { lookupAiCache, storeAiCache } from "@/lib/ai/cache";
import { triageAnalysisSchema } from "@/lib/ai/schemas/triage";
import { TRIAGE_SYSTEM_PROMPT } from "@/lib/ai/prompts/triage";
import { buildTriageContext } from "@/features/intelligence/triage-context";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { issueId?: string } | null;
    const issueId = typeof body?.issueId === "string" ? body.issueId : null;
    if (!issueId) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "issueId is required." }, { status: 400 });

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Authentication required." }, { status: 401 });

    const { data: issue, error: issueError } = await supabase.from("issues").select("*").eq("id", issueId).maybeSingle();
    if (issueError || !issue) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Issue not found or not visible." }, { status: 404 });

    const projectId = (issue as { project_id: string }).project_id;
    const visibility = (issue as { visibility?: string | null }).visibility ?? "PROJECT";
    if (visibility === "RESTRICTED") {
      return NextResponse.json({ code: "AI_DISABLED_FOR_RESTRICTED_ISSUE", message: "Trace AI is disabled for restricted issues." }, { status: 403 });
    }

    const canView = await supabase.rpc("can_view_issue" as never, { p_issue_id: issueId } as never);
    if (canView.error || !canView.data) {
      return NextResponse.json({ code: "AI_DISABLED_FOR_RESTRICTED_ISSUE", message: "Trace AI is disabled for restricted issues." }, { status: 403 });
    }

    const [{ data: projectRow }, { data: components }, { data: memberRows }, { data: attachments }] = await Promise.all([
      supabase.from("projects").select("key").eq("id", projectId).maybeSingle(),
      supabase.from("components").select("id, name, description, default_assignee_id").eq("project_id", projectId).eq("is_archived", false),
      supabase.from("project_members").select("user_id").eq("project_id", projectId),
      supabase.from("attachments").select("filename, mime_type").eq("issue_id", issueId).limit(10),
    ]);

    const projectKey = (projectRow as { key?: string } | null)?.key ?? undefined;

    const assigneeOptions = (memberRows ?? []).map((row) => ({ user_id: (row as { user_id: string }).user_id, display_name: null as string | null }));
    if (assigneeOptions.length > 0) {
      const ids = assigneeOptions.map((entry) => entry.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      const nameMap = new Map((profiles ?? []).map((profile) => [(profile as { id: string; display_name: string | null }).id, (profile as { display_name: string | null }).display_name]));
      for (const option of assigneeOptions) option.display_name = nameMap.get(option.user_id) ?? null;
    }

    const titleForDuplicates = (issue as { title: string }).title;
    let duplicateCandidates: Array<{ id: string; issue_number: number; title: string; description: string | null; component_id: string | null; affected_version_id: string | null; status?: string | null; similarity?: number | null }> = [];
    try {
      const { data: rpcData } = await supabase.rpc("find_duplicate_candidates" as never, { p_project_id: projectId, p_title: titleForDuplicates, p_limit: 3 } as never);
      const rawCandidates = (rpcData as Array<{ issue_id: string; issue_number: number; title: string; similarity: number }> | null) ?? [];
      const filteredIds = rawCandidates.filter((candidate) => candidate.issue_id !== issueId).slice(0, 3).map((candidate) => candidate.issue_id);
      if (filteredIds.length > 0) {
        const { data: candidateRows } = await supabase.from("issues").select("id, issue_number, title, description, component_id, affected_version_id, status_id").in("id", filteredIds);
        const statusIds = [...new Set((candidateRows ?? []).map((row) => (row as { status_id: string }).status_id))];
        let statusMap = new Map<string, string>();
        if (statusIds.length > 0) {
          const { data: statusRows } = await supabase.from("workflow_states").select("id, name").in("id", statusIds);
          statusMap = new Map((statusRows ?? []).map((row) => [(row as { id: string; name: string }).id, (row as { name: string }).name]));
        }
        const simMap = new Map(rawCandidates.map((candidate) => [candidate.issue_id, candidate.similarity]));
        duplicateCandidates = (candidateRows ?? [])
          .filter((row) => {
            const typed = row as { id: string };
            return filteredIds.includes(typed.id);
          })
          .map((row) => {
            const typed = row as { id: string; issue_number: number; title: string; description: string | null; component_id: string | null; affected_version_id: string | null; status_id: string };
            return {
              id: typed.id,
              issue_number: typed.issue_number,
              title: typed.title,
              description: typed.description,
              component_id: typed.component_id,
              affected_version_id: typed.affected_version_id,
              status: statusMap.get(typed.status_id) ?? null,
              similarity: simMap.get(typed.id) ?? null,
            };
          });
        const visibleCandidates: typeof duplicateCandidates = [];
        for (const candidate of duplicateCandidates) {
          const { data: canViewCandidate } = await supabase.rpc("can_view_issue" as never, { p_issue_id: candidate.id } as never);
          if (canViewCandidate) visibleCandidates.push(candidate);
        }
        duplicateCandidates = visibleCandidates.slice(0, 3);
      }
    } catch {
      duplicateCandidates = [];
    }

    const context = buildTriageContext({
      issue: {
        id: (issue as { id: string }).id,
        issue_number: (issue as { issue_number: number }).issue_number,
        project_id: projectId,
        title: (issue as { title: string }).title,
        description: (issue as { description: string | null }).description,
        type: (issue as { type: string }).type,
        priority: (issue as { priority: string }).priority,
        severity: (issue as { severity: string }).severity,
        status_id: (issue as { status_id: string }).status_id,
        component_id: (issue as { component_id: string | null }).component_id,
        affected_version_id: (issue as { affected_version_id: string | null }).affected_version_id,
        target_milestone_id: (issue as { target_milestone_id: string | null }).target_milestone_id,
        environment: (issue as { environment: string | null }).environment,
        steps_to_reproduce: (issue as { steps_to_reproduce: string | null }).steps_to_reproduce,
        expected_behavior: (issue as { expected_behavior: string | null }).expected_behavior,
        actual_behavior: (issue as { actual_behavior: string | null }).actual_behavior,
        visibility,
        updated_at: (issue as { updated_at: string }).updated_at,
      },
      components: (components as Array<{ id: string; name: string; description: string | null; default_assignee_id: string | null }> | null) ?? [],
      assignees: assigneeOptions.map((entry) => ({ user_id: entry.user_id, display_name: entry.display_name })),
      duplicateCandidates: duplicateCandidates.map((candidate) => ({ id: candidate.id, issue_number: candidate.issue_number, title: candidate.title, description: candidate.description, component_id: candidate.component_id, affected_version_id: candidate.affected_version_id, status: candidate.status ?? null, similarity: candidate.similarity ?? undefined })),
      attachments: (attachments as Array<{ filename: string | null; mime_type: string | null }> | null) ?? undefined,
      projectKey,
    });

    const redacted = redactObject(context);
    const inputHash = canonicalHash(redacted, AI_MODEL);

    const cached = await lookupAiCache({ feature: "TRIAGE", projectId, inputHash, issueId });
    if (cached) {
      const parsedCached = triageAnalysisSchema.safeParse(cached);
      if (parsedCached.success) {
        return NextResponse.json({ data: parsedCached.data, cached: true, inputHash });
      }
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ code: "AI_NOT_CONFIGURED", message: "Trace AI is not configured." }, { status: 503 });
    }

    const raw = await groqJson<unknown>({ systemPrompt: TRIAGE_SYSTEM_PROMPT, userPayload: redacted });
    const parsed = triageAnalysisSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ code: "AI_INVALID_RESPONSE", message: "Trace AI returned an invalid response.", details: parsed.error.flatten() }, { status: 502 });
    }

    const allowedComponentIds = new Set((components ?? []).map((component) => (component as { id: string }).id));
    const allowedAssigneeIds = new Set(assigneeOptions.map((entry) => entry.user_id));
    const allowedDuplicateIds = new Set(duplicateCandidates.map((candidate) => candidate.id));

    let sanitized = parsed.data;
    if (sanitized.component.component_id && !allowedComponentIds.has(sanitized.component.component_id)) sanitized = { ...sanitized, component: { ...sanitized.component, component_id: null, confidence: 0, reason: "Model suggested unknown component; cleared." } };
    if (sanitized.assignee.user_id && !allowedAssigneeIds.has(sanitized.assignee.user_id)) sanitized = { ...sanitized, assignee: { ...sanitized.assignee, user_id: null, confidence: 0, reason: "Model suggested unknown assignee; cleared." } };
    const filteredDuplicates = sanitized.duplicate_analysis.filter((entry) => allowedDuplicateIds.has(entry.issue_id));
    if (filteredDuplicates.length !== sanitized.duplicate_analysis.length) sanitized = { ...sanitized, duplicate_analysis: filteredDuplicates };

    await storeAiCache({ feature: "TRIAGE", projectId, inputHash, issueId, model: AI_MODEL, result: sanitized });

    return NextResponse.json({ data: sanitized, cached: false, inputHash });
  } catch (error) {
    if (error instanceof AiError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    console.error("triage intelligence error", error);
    return NextResponse.json({ code: "AI_PROVIDER_ERROR", message: "Trace AI is temporarily unavailable." }, { status: 502 });
  }
}
