import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { AI_MAX_QUERY_CHARS, AI_MODEL, AI_PROMPT_VERSION, AI_SCHEMA_VERSION } from "@/lib/ai/config";
import { geminiJson } from "@/lib/ai/client";
import { canonicalHash } from "@/lib/ai/hash";
import { claimAiAnalysis, completeAiAnalysis, failAiAnalysis, getCachedAiAnalysis } from "@/lib/ai/cache";
import { SEARCH_SYSTEM_PROMPT } from "@/lib/ai/prompts/search";
import { SEARCH_JSON_SCHEMA, searchParseSchema } from "@/lib/ai/schemas/search";
import { sanitizeSearchFilters } from "@/features/intelligence/search-filters";
import { boundedJson, errorResponse, getRequestLogId, isUuid, jsonError, sameOrigin } from "@/lib/ai/http";
import { AiError } from "@/lib/ai/errors";
export async function POST(request: NextRequest) {
  let key: Parameters<typeof claimAiAnalysis>[0] | null = null; let claimId: string | undefined;
  try {
    if (!sameOrigin(request)) return jsonError("AI_NOT_AUTHORIZED");
    const body = await boundedJson(request); const projectId = typeof body?.projectId === "string" ? body.projectId : null; const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!isUuid(projectId) || !query || query.length > AI_MAX_QUERY_CHARS) return jsonError("AI_CONTEXT_UNAVAILABLE", 400);
    const supabase = await createClient(); const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError && !isMissingAuthSession(authError)) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!auth.user) return jsonError("AI_CONTEXT_UNAVAILABLE", 401);
    const { data: project, error: projectError } = await supabase.from("projects").select("id, organization_id").eq("id", projectId).maybeSingle(); if (projectError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!project) return jsonError("AI_CONTEXT_UNAVAILABLE", 404);
    const { data: member, error: memberError } = await supabase.rpc("is_project_member", { p_project_id: projectId }); if (memberError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!member) return jsonError("AI_NOT_AUTHORIZED");
    const [{ data: states, error: statesError }, { data: components, error: componentsError }, { data: versions, error: versionsError }, { data: milestones, error: milestonesError }, { data: labels, error: labelsError }, { data: fields, error: fieldsError }, { data: members, error: membersError }, { data: admins, error: adminsError }] = await Promise.all([
      supabase.from("workflow_states").select("id, name, category").eq("project_id", projectId).limit(100), supabase.from("components").select("id, name").eq("project_id", projectId).eq("is_archived", false).limit(100), supabase.from("versions").select("id, name").eq("project_id", projectId).eq("is_archived", false).limit(100), supabase.from("milestones").select("id, name").eq("project_id", projectId).limit(100), supabase.from("labels").select("id, name").eq("project_id", projectId).limit(100), supabase.from("custom_fields").select("id, name").eq("project_id", projectId).limit(100), supabase.from("project_members").select("user_id").eq("project_id", projectId).limit(100), supabase.from("organization_members").select("user_id").eq("organization_id", project.organization_id).in("role", ["OWNER", "ADMIN"]).limit(100),
    ]);
    if (statesError || componentsError || versionsError || milestonesError || labelsError || fieldsError || membersError || adminsError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const people = [...new Map([...(members ?? []), ...(admins ?? [])].map((row) => [row.user_id, row])).values()];
    const { data: profiles, error: profilesError } = people.length > 0 ? await supabase.from("profiles").select("id, display_name").in("id", people.map((row) => row.user_id)) : { data: [], error: null };
    if (profilesError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const profileNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
    const allowedPeople = people.map((person) => ({ user_id: person.user_id, display_name: profileNames.get(person.user_id) ?? null }));
    const context = { query, allowed: { statuses: states ?? [], components: components ?? [], versions: versions ?? [], milestones: milestones ?? [], labels: labels ?? [], customFields: fields ?? [], members: allowedPeople, priorities: ["P0","P1","P2","P3","P4"], severities: ["BLOCKER","CRITICAL","MAJOR","MINOR","TRIVIAL"], types: ["BUG","ENHANCEMENT","TASK","SECURITY","PERFORMANCE","REGRESSION"], resolutions: ["FIXED","DUPLICATE","WONT_FIX","INVALID","CANNOT_REPRODUCE","WORKS_AS_EXPECTED"] } };
    key = { feature: "NATURAL_LANGUAGE_SEARCH", projectId, inputHash: canonicalHash({ context, schema: SEARCH_JSON_SCHEMA }, AI_MODEL), model: AI_MODEL, schemaVersion: AI_SCHEMA_VERSION, promptVersion: AI_PROMPT_VERSION };
    if (body?.analyze !== true) {
      const cachedValue = await getCachedAiAnalysis(key);
      const cached = cachedValue === null ? null : searchParseSchema.safeParse(cachedValue).data;
      return NextResponse.json({ data: cached ?? null, cached: Boolean(cached), requiresAnalyze: !cached });
    }
    const claim = await claimAiAnalysis(key); claimId = claim.claimId; const cached = claim.result === undefined ? null : searchParseSchema.safeParse(claim.result).data;
    if (claim.status === "HIT" && cached) return NextResponse.json({ data: cached, cached: true });
    if (claim.status === "IN_PROGRESS") return jsonError("AI_CLAIM_CONFLICT");
    const raw = await geminiJson<unknown>({ systemPrompt: SEARCH_SYSTEM_PROMPT, userPayload: context, schemaName: "tracebox_search_filters", jsonSchema: SEARCH_JSON_SCHEMA, requestId: getRequestLogId(request) });
    const parsed = searchParseSchema.safeParse(raw); if (!parsed.success) throw new AiError("AI_INVALID_RESPONSE");
    const result = sanitizeSearchFilters(parsed.data, { statuses: new Set((states ?? []).map((x) => String((x as { id: string }).id))), components: new Set((components ?? []).map((x) => String((x as { id: string }).id))), members: new Set(people.map((x) => String(x.user_id))), versions: new Set((versions ?? []).map((x) => String((x as { id: string }).id))), milestones: new Set((milestones ?? []).map((x) => String((x as { id: string }).id))), labels: new Set((labels ?? []).map((x) => String((x as { id: string }).id))), customFields: new Set((fields ?? []).map((x) => String((x as { id: string }).id))) });
    await completeAiAnalysis(key, claimId, result); return NextResponse.json({ data: result, cached: false });
  } catch (error) { if (key && claimId) await failAiAnalysis(key, claimId).catch(() => undefined); return errorResponse(error, request); }
}
