import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { AI_MODEL } from "@/lib/ai/config";
import { groqJson } from "@/lib/ai/client";
import { AiError } from "@/lib/ai/errors";
import { canonicalHash } from "@/lib/ai/hash";
import { redactObject } from "@/lib/ai/redact";
import { lookupAiCache, storeAiCache } from "@/lib/ai/cache";
import { searchParseResponseSchema } from "@/lib/ai/schemas/search";
import { SEARCH_SYSTEM_PROMPT } from "@/lib/ai/prompts/search";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { projectId?: string; query?: string } | null;
    const projectId = typeof body?.projectId === "string" ? body.projectId : null;
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!projectId || !query || query.length > 200) {
      return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "projectId and 1-200 char query required." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Authentication required." }, { status: 401 });

    const { data: project, error: projectError } = await supabase.from("projects").select("id, organization_id").eq("id", projectId).maybeSingle();
    if (projectError || !project) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Project not found or not visible." }, { status: 404 });

    const isMember = await supabase.rpc("is_project_member" as never, { p_project_id: projectId } as never);
    if (isMember.error || !isMember.data) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Not a project member." }, { status: 403 });

    const [{ data: states }, { data: components }, { data: versions }, { data: milestones }, { data: labels }] = await Promise.all([
      supabase.from("workflow_states").select("id, name, category").eq("project_id", projectId),
      supabase.from("components").select("id, name").eq("project_id", projectId).eq("is_archived", false),
      supabase.from("versions").select("id, name").eq("project_id", projectId).eq("is_archived", false),
      supabase.from("milestones").select("id, name").eq("project_id", projectId),
      supabase.from("labels").select("id, name").eq("project_id", projectId),
    ]);

    const context = {
      query,
      allowed: {
        statuses: (states ?? []).map((state) => ({ id: (state as { id: string }).id, name: (state as { name: string }).name })),
        components: (components ?? []).map((component) => ({ id: (component as { id: string }).id, name: (component as { name: string }).name })),
        versions: (versions ?? []).map((version) => ({ id: (version as { id: string }).id, name: (version as { name: string }).name })),
        milestones: (milestones ?? []).map((milestone) => ({ id: (milestone as { id: string }).id, name: (milestone as { name: string }).name })),
        labels: (labels ?? []).map((label) => ({ id: (label as { id: string }).id, name: (label as { name: string }).name })),
        priorities: ["P0", "P1", "P2", "P3", "P4"],
        severities: ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"],
        types: ["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"],
        resolutions: ["FIXED", "DUPLICATE", "WONT_FIX", "INVALID", "CANNOT_REPRODUCE", "WORKS_AS_EXPECTED"],
      },
      currentUserId: auth.user.id,
    };

    const redacted = redactObject(context);
    const inputHash = canonicalHash(redacted, AI_MODEL);

    const cached = await lookupAiCache({ feature: "SEARCH", projectId, inputHash });
    if (cached) {
      const parsedCached = searchParseResponseSchema.safeParse(cached);
      if (parsedCached.success) return NextResponse.json({ data: parsedCached.data, cached: true });
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ code: "AI_NOT_CONFIGURED", message: "Trace AI is not configured." }, { status: 503 });
    }

    const raw = await groqJson<unknown>({ systemPrompt: SEARCH_SYSTEM_PROMPT, userPayload: redacted });
    const parsed = searchParseResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ code: "AI_INVALID_RESPONSE", message: "Trace AI returned an invalid response." }, { status: 502 });
    }

    const allowedStatusIds = new Set((states ?? []).map((state) => (state as { id: string }).id));
    const allowedComponentIds = new Set((components ?? []).map((component) => (component as { id: string }).id));
    const allowedVersionIds = new Set((versions ?? []).map((version) => (version as { id: string }).id));
    const allowedMilestoneIds = new Set((milestones ?? []).map((milestone) => (milestone as { id: string }).id));
    const allowedLabelIds = new Set((labels ?? []).map((label) => (label as { id: string }).id));

    const data = parsed.data;
    const sanitized = {
      ...data,
      statuses: data.statuses.filter((id) => allowedStatusIds.has(id)),
      component_id: data.component_id && allowedComponentIds.has(data.component_id) ? data.component_id : null,
      affected_version_id: data.affected_version_id && allowedVersionIds.has(data.affected_version_id) ? data.affected_version_id : null,
      target_milestone_id: data.target_milestone_id && allowedMilestoneIds.has(data.target_milestone_id) ? data.target_milestone_id : null,
      labels: data.labels.filter((id) => allowedLabelIds.has(id)),
      assignee: data.assignee === "ME" ? "ME" : data.assignee && allowedStatusIds.has(data.assignee) ? data.assignee : null,
    };

    await storeAiCache({ feature: "SEARCH", projectId, inputHash, model: AI_MODEL, result: sanitized });

    return NextResponse.json({ data: sanitized, cached: false });
  } catch (error) {
    if (error instanceof AiError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    console.error("search intelligence error", error);
    return NextResponse.json({ code: "AI_PROVIDER_ERROR", message: "Trace AI is temporarily unavailable." }, { status: 502 });
  }
}
