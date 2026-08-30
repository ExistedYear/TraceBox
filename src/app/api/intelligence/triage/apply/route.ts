import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { boundedJson, errorResponse, jsonError, sameOrigin } from "@/lib/ai/http";
import { AiError } from "@/lib/ai/errors";
import type { Json } from "@/types/database";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return jsonError("AI_NOT_AUTHORIZED");
    const body = await boundedJson(request); const issueId = typeof body?.issueId === "string" ? body.issueId : null; const expected = typeof body?.updatedAt === "string" ? body.updatedAt : null; const suggestion = body?.suggestion;
    if (!issueId || !uuid.test(issueId) || !expected || !suggestion || typeof suggestion !== "object") return jsonError("AI_CONTEXT_UNAVAILABLE", 400);
    const supabase = await createClient(); const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError && !isMissingAuthSession(authError)) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!auth.user) return jsonError("AI_CONTEXT_UNAVAILABLE", 401);
    const s = suggestion as Record<string, unknown>; const component = s.component && typeof s.component === "object" ? s.component as Record<string, unknown> : {}; const severity = s.severity && typeof s.severity === "object" ? s.severity as Record<string, unknown> : {}; const priority = s.priority && typeof s.priority === "object" ? s.priority as Record<string, unknown> : {}; const assignee = s.assignee && typeof s.assignee === "object" ? s.assignee as Record<string, unknown> : {};
    const updates: Record<string, unknown> = {};
    if (typeof component.component_id === "string" && uuid.test(component.component_id)) updates.component_id = component.component_id;
    if (typeof severity.value === "string") updates.severity = severity.value;
    if (typeof priority.value === "string") updates.priority = priority.value;
    if (typeof assignee.user_id === "string" && uuid.test(assignee.user_id)) updates.assignee_id = assignee.user_id;
    if (Object.keys(updates).length === 0) return jsonError("AI_CONTEXT_UNAVAILABLE", 400);
    const { data, error } = await supabase.rpc("apply_issue_triage_updates", { p_issue_id: issueId, p_updates: updates as Json, p_expected_updated_at: expected }); if (error) { if (error.code === "42501") return jsonError("AI_NOT_AUTHORIZED"); if (error.code === "40001" || error.code === "409") return jsonError("AI_STALE_ISSUE"); throw new AiError("AI_CONTEXT_UNAVAILABLE"); }
    return NextResponse.json({ data });
  } catch (error) { return errorResponse(error); }
}
