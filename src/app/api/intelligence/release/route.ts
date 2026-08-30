import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { normalizeReadinessAnalysis } from "@/lib/readiness";
import { AI_MODEL, AI_PROMPT_VERSION, AI_SCHEMA_VERSION } from "@/lib/ai/config";
import { openRouterJson } from "@/lib/ai/client";
import { canonicalHash } from "@/lib/ai/hash";
import { claimAiAnalysis, completeAiAnalysis, failAiAnalysis, getCachedAiAnalysis } from "@/lib/ai/cache";
import { releaseBriefSchema, RELEASE_JSON_SCHEMA } from "@/lib/ai/schemas/release";
import { RELEASE_SYSTEM_PROMPT } from "@/lib/ai/prompts/release";
import { buildReleaseContext } from "@/features/intelligence/release-context";
import { boundedJson, errorResponse, isUuid, jsonError, sameOrigin } from "@/lib/ai/http";
import { AiError } from "@/lib/ai/errors";
export async function POST(request: NextRequest) {
  let key: Parameters<typeof claimAiAnalysis>[0] | null = null; let claimId: string | undefined;
  try {
    if (!sameOrigin(request)) return jsonError("AI_NOT_AUTHORIZED");
    const body = await boundedJson(request); const projectId = typeof body?.projectId === "string" ? body.projectId : null; const milestoneId = typeof body?.milestoneId === "string" ? body.milestoneId : null; const versionId = typeof body?.versionId === "string" ? body.versionId : null;
    if (!isUuid(projectId) || (!isUuid(milestoneId) && !isUuid(versionId)) || (milestoneId !== null && !isUuid(milestoneId)) || (versionId !== null && !isUuid(versionId))) return jsonError("AI_CONTEXT_UNAVAILABLE", 400);
    const supabase = await createClient(); const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError && !isMissingAuthSession(authError)) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!auth.user) return jsonError("AI_CONTEXT_UNAVAILABLE", 401);
    const { data: project, error: projectError } = await supabase.from("projects").select("id, key").eq("id", projectId).maybeSingle(); if (projectError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!project) return jsonError("AI_CONTEXT_UNAVAILABLE", 404);
    const { data: member, error: memberError } = await supabase.rpc("is_project_member", { p_project_id: projectId }); if (memberError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!member) return jsonError("AI_NOT_AUTHORIZED");
    let unsafeQuery = supabase.from("issues").select("id").eq("project_id", projectId).or("visibility.eq.RESTRICTED,type.eq.SECURITY");
    if (milestoneId) unsafeQuery = unsafeQuery.eq("target_milestone_id", milestoneId);
    if (versionId) unsafeQuery = unsafeQuery.eq("affected_version_id", versionId);
    const [{ data: readiness, error: readinessError }, { data: milestone, error: milestoneError }, { data: version, error: versionError }, { data: unsafeIssues, error: unsafeError }] = await Promise.all([
      supabase.rpc("calculate_release_readiness", { p_project_id: projectId, p_milestone_id: milestoneId ?? undefined, p_version_id: versionId ?? undefined }),
      milestoneId ? supabase.from("milestones").select("name").eq("id", milestoneId).eq("project_id", projectId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      versionId ? supabase.from("versions").select("name").eq("id", versionId).eq("project_id", projectId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      unsafeQuery.limit(1),
    ]);
    if (readinessError || milestoneError || versionError || unsafeError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    if (milestoneId && !milestone) return jsonError("AI_CONTEXT_UNAVAILABLE", 404);
    if (versionId && !version) return jsonError("AI_CONTEXT_UNAVAILABLE", 404);
    if ((unsafeIssues ?? []).length > 0) return jsonError("AI_DISABLED_FOR_RESTRICTED_ISSUE");
    const analysis = normalizeReadinessAnalysis(readiness, String((project as { key: string }).key));
    // The readiness RPC is authoritative. This route only selects its permitted metadata; it never recalculates the score.
    const priorityRank = new Map([["P0", 0], ["P1", 1], ["P2", 2], ["P3", 3], ["P4", 4]]); const severityRank = new Map([["BLOCKER", 0], ["CRITICAL", 1], ["MAJOR", 2], ["MINOR", 3], ["TRIVIAL", 4]]);
    const topIssues = analysis.issues.filter((issue) => issue.type !== "SECURITY").filter((issue) => issue.statusCategory !== "RESOLVED" && issue.statusCategory !== "CLOSED").sort((a, b) => (priorityRank.get(a.priority) ?? 9) - (priorityRank.get(b.priority) ?? 9) || (severityRank.get(a.severity) ?? 9) - (severityRank.get(b.severity) ?? 9) || a.issueNumber - b.issueNumber).slice(0, 8).map((issue) => ({ id: issue.id, keyLabel: issue.keyLabel, title: issue.title, type: issue.type, priority: issue.priority, severity: issue.severity, statusCategory: issue.statusCategory, componentName: issue.componentName }));
    const readinessSummary = readiness && typeof readiness === "object" && !Array.isArray(readiness) ? Object.fromEntries(Object.entries(readiness as Record<string, unknown>).filter(([keyName]) => keyName !== "issues")) : {};
    const context = buildReleaseContext({ milestoneName: (milestone as { name?: string } | null)?.name, versionName: (version as { name?: string } | null)?.name, readiness: readinessSummary, topIssues });
    key = { feature: "RELEASE_RISK", projectId, contextIssueIds: topIssues.map((issue) => issue.id), inputHash: canonicalHash({ milestoneId, versionId, context, schema: RELEASE_JSON_SCHEMA }, AI_MODEL), model: AI_MODEL, schemaVersion: AI_SCHEMA_VERSION, promptVersion: AI_PROMPT_VERSION };
    if (body?.analyze !== true) {
      const cachedValue = await getCachedAiAnalysis(key);
      const cached = cachedValue === null ? null : releaseBriefSchema.safeParse(cachedValue).data;
      return NextResponse.json({ data: cached ?? null, cached: Boolean(cached), requiresAnalyze: !cached });
    }
    const claim = await claimAiAnalysis(key); claimId = claim.claimId; const cached = claim.result === undefined ? null : releaseBriefSchema.safeParse(claim.result).data;
    if (claim.status === "HIT" && cached) return NextResponse.json({ data: cached, cached: true });
    if (claim.status === "IN_PROGRESS") return jsonError("AI_CLAIM_CONFLICT");
    const raw = await openRouterJson<unknown>({ systemPrompt: RELEASE_SYSTEM_PROMPT, userPayload: context, schemaName: "tracebox_release_brief", jsonSchema: RELEASE_JSON_SCHEMA }); const parsed = releaseBriefSchema.safeParse(raw); if (!parsed.success) throw new AiError("AI_INVALID_RESPONSE");
    const allowed = new Set(topIssues.map((i) => i.keyLabel)); const result = { ...parsed.data, primary_risks: parsed.data.primary_risks.filter((risk) => allowed.has(risk.issue_key)) };
    await completeAiAnalysis(key, claimId, result); return NextResponse.json({ data: result, cached: false });
  } catch (error) { if (key && claimId) await failAiAnalysis(key, claimId).catch(() => undefined); return errorResponse(error); }
}
