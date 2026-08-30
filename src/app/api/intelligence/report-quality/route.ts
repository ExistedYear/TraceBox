import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import { calculateReportQuality, type IssueForQuality } from "@/features/intelligence/report-quality";
import { boundedJson, errorResponse, isUuid, jsonError, sameOrigin } from "@/lib/ai/http";
import { AiError } from "@/lib/ai/errors";
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return jsonError("AI_NOT_AUTHORIZED");
    const body = await boundedJson(request); const issueId = typeof body?.issueId === "string" ? body.issueId : null;
    if (!isUuid(issueId)) return jsonError("AI_CONTEXT_UNAVAILABLE", 400);
    const supabase = await createClient(); const { data: auth, error: authError } = await supabase.auth.getUser(); if (authError && !isMissingAuthSession(authError)) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!auth.user) return jsonError("AI_CONTEXT_UNAVAILABLE", 401);
    const { data: issue, error: issueError } = await supabase.from("issues").select("id, project_id, type, visibility, title, description, steps_to_reproduce, expected_behavior, actual_behavior, environment, affected_version_id").eq("id", issueId).maybeSingle();
    if (issueError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    if (!issue) return jsonError("AI_CONTEXT_UNAVAILABLE", 404);
    const { data: allowed, error: accessError } = await supabase.rpc("can_view_issue", { p_issue_id: issueId }); if (accessError) throw new AiError("AI_CONTEXT_UNAVAILABLE"); if (!allowed) return jsonError("AI_NOT_AUTHORIZED");
    const { data: attachments, error: attachmentsError } = await supabase.from("attachments").select("filename, mime_type").eq("issue_id", issueId);
    if (attachmentsError) throw new AiError("AI_CONTEXT_UNAVAILABLE");
    const row = issue as Record<string, unknown>;
    const quality = calculateReportQuality(row as IssueForQuality, attachments ?? []);
    return NextResponse.json({ data: quality });
  } catch (error) { return errorResponse(error, request); }
}
