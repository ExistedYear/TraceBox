import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { AI_MODEL, AI_PROMPT_VERSION, AI_SCHEMA_VERSION } from "@/lib/ai/config";
import { geminiJson } from "@/lib/ai/client";
import { AiError } from "@/lib/ai/errors";
import { canonicalHash } from "@/lib/ai/hash";
import { redactObject } from "@/lib/ai/redact";
import { claimAiAnalysis, completeAiAnalysis, failAiAnalysis, getCachedAiAnalysis } from "@/lib/ai/cache";
import { triageAnalysisSchema, TRIAGE_JSON_SCHEMA } from "@/lib/ai/schemas/triage";
import { TRIAGE_SYSTEM_PROMPT } from "@/lib/ai/prompts/triage";
import { buildTriageContext, type TriageIssueInput } from "@/features/intelligence/triage-context";
import { boundedJson, errorResponse, getRequestLogId, isUuid, jsonError, sameOrigin } from "@/lib/ai/http";

export async function POST(request: NextRequest) {
  let key: Parameters<typeof claimAiAnalysis>[0] | null = null; let claimId: string | undefined;
  try {
    if (!sameOrigin(request)) return jsonError("AI_NOT_AUTHORIZED");
    const body = await boundedJson(request); const issueId = typeof body?.issueId === "string" ? body.issueId : null; const analyze = body?.analyze === true;
    if (!isUuid(issueId)) return jsonError("AI_CONTEXT_UNAVAILABLE", 400);
    const supabase = await createClient(); const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError && !isMissingAuthSession(authError)) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!auth.user) return jsonError("AI_CONTEXT_UNAVAILABLE", 401);
    const { data: issue, error: issueError } = await supabase.from("issues").select("id, issue_number, project_id, title, description, steps_to_reproduce, expected_behavior, actual_behavior, environment, type, priority, severity, status_id, component_id, affected_version_id, target_milestone_id, visibility, updated_at").eq("id", issueId).maybeSingle();
    if (issueError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    if (!issue) return jsonError("AI_CONTEXT_UNAVAILABLE", 404);
    const row = issue as Record<string, unknown>; if (row.visibility === "RESTRICTED" || row.type === "SECURITY") return jsonError("AI_DISABLED_FOR_RESTRICTED_ISSUE");
    const { data: canView, error: accessError } = await supabase.rpc("can_view_issue", { p_issue_id: issueId }); if (accessError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!canView) return jsonError("AI_NOT_AUTHORIZED");
    const projectId = String(row.project_id);
    const [{ data: project, error: projectError }, { data: components, error: componentsError }, { data: members, error: membersError }, { data: candidates, error: candidatesError }] = await Promise.all([
      supabase.from("projects").select("key, organization_id").eq("id", projectId).maybeSingle(),
      supabase.from("components").select("id, name, default_assignee_id").eq("project_id", projectId).eq("is_archived", false).limit(100),
      supabase.from("project_members").select("user_id").eq("project_id", projectId).limit(100),
      supabase.rpc("find_duplicate_candidates", { p_project_id: projectId, p_title: String(row.title), p_limit: 3 }),
    ]);
    if (projectError || componentsError || membersError || candidatesError || !project) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const { data: adminRows, error: adminsError } = await supabase.from("organization_members").select("user_id").eq("organization_id", project.organization_id).in("role", ["OWNER", "ADMIN"]).limit(100);
    if (adminsError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const people = [...new Map([...(members ?? []), ...(adminRows ?? [])].map((person) => [person.user_id, person])).values()];
    const { data: profiles, error: profilesError } = people.length > 0 ? await supabase.from("profiles").select("id, display_name").in("id", people.map((person) => person.user_id)) : { data: [], error: null };
    if (profilesError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const profileNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
    const rawCandidates = (Array.isArray(candidates as unknown) ? (candidates as unknown) as unknown[] : []).filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object" && (c as Record<string, unknown>).issue_id !== issueId)).slice(0, 6);
    const candidateIds = rawCandidates.map((candidate) => String(candidate.issue_id));
    const { data: candidateDetails, error: candidateDetailsError } = candidateIds.length > 0
      ? await supabase.from("issues").select("id, issue_number, title, description, type, priority, severity, visibility, status:workflow_states(name)").in("id", candidateIds).eq("project_id", projectId).eq("visibility", "PROJECT").neq("type", "SECURITY")
      : { data: [], error: null };
    if (candidateDetailsError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const similarity = new Map(rawCandidates.map((candidate) => [String(candidate.issue_id), typeof candidate.similarity === "number" ? candidate.similarity : undefined]));
    const candidateRows = ((candidateDetails ?? []) as unknown as Array<Record<string, unknown>>).slice(0, 3);
    const context = buildTriageContext({ issue: row as unknown as TriageIssueInput, projectKey: (project as { key?: string } | null)?.key, components: components ?? [], assignees: people.map((person) => ({ user_id: person.user_id, display_name: profileNames.get(person.user_id) ?? null })), duplicateCandidates: candidateRows.map((c) => ({ id: String(c.id), issue_number: Number(c.issue_number), project_key: (project as { key?: string } | null)?.key, title: String(c.title ?? ""), description: typeof c.description === "string" ? c.description : null, type: typeof c.type === "string" ? c.type : undefined, priority: typeof c.priority === "string" ? c.priority : undefined, severity: typeof c.severity === "string" ? c.severity : undefined, status: typeof (c.status as { name?: unknown } | null)?.name === "string" ? String((c.status as { name: string }).name) : null, similarity: similarity.get(String(c.id)) })) });
    const safeContext = redactObject(context); key = { feature: "TRIAGE", projectId, issueId, contextIssueIds: [issueId, ...candidateRows.map((candidate) => String(candidate.id))], inputHash: canonicalHash({ context: safeContext, schema: TRIAGE_JSON_SCHEMA }, AI_MODEL), model: AI_MODEL, schemaVersion: AI_SCHEMA_VERSION, promptVersion: AI_PROMPT_VERSION };
    if (!analyze) {
      const cachedValue = await getCachedAiAnalysis(key);
      const cached = cachedValue === null ? null : triageAnalysisSchema.safeParse(cachedValue).data;
      return NextResponse.json({ data: cached ?? null, cached: Boolean(cached), requiresAnalyze: !cached, inputHash: key.inputHash });
    }
    const claim = await claimAiAnalysis(key); claimId = claim.claimId;
    const cached = claim.result === undefined ? null : triageAnalysisSchema.safeParse(claim.result).data;
    if (claim.status === "HIT" && cached) return NextResponse.json({ data: cached, cached: true, inputHash: key.inputHash });
    if (claim.status === "IN_PROGRESS") return jsonError("AI_CLAIM_CONFLICT");
    const raw = await geminiJson<unknown>({ systemPrompt: TRIAGE_SYSTEM_PROMPT, userPayload: safeContext, schemaName: "tracebox_triage", jsonSchema: TRIAGE_JSON_SCHEMA, requestId: getRequestLogId(request) });
    const parsed = triageAnalysisSchema.safeParse(raw); if (!parsed.success) throw new AiError("AI_INVALID_RESPONSE");
    const componentIds = new Set((components ?? []).map((c) => String((c as { id: string }).id))); const assigneeIds = new Set(people.map((person) => person.user_id)); const allowedCandidateIds = new Set(candidateRows.map((c) => String(c.id)));
    const value = { ...parsed.data, component: { ...parsed.data.component, component_id: parsed.data.component.component_id && componentIds.has(parsed.data.component.component_id) ? parsed.data.component.component_id : null }, assignee: { ...parsed.data.assignee, user_id: parsed.data.assignee.user_id && assigneeIds.has(parsed.data.assignee.user_id) ? parsed.data.assignee.user_id : null }, duplicate_analysis: parsed.data.duplicate_analysis.filter((d) => allowedCandidateIds.has(d.issue_id)).slice(0, 3) };
    await completeAiAnalysis(key, claimId, value); return NextResponse.json({ data: value, cached: false, inputHash: key.inputHash });
  } catch (error) { if (key && claimId) await failAiAnalysis(key, claimId).catch(() => undefined); return errorResponse(error, request); }
}
