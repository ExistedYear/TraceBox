import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { AI_MODEL } from "@/lib/ai/config";
import { groqJson } from "@/lib/ai/client";
import { AiError } from "@/lib/ai/errors";
import { canonicalHash } from "@/lib/ai/hash";
import { redactObject } from "@/lib/ai/redact";
import { lookupAiCache, storeAiCache } from "@/lib/ai/cache";
import { releaseBriefSchema } from "@/lib/ai/schemas/release";
import { RELEASE_SYSTEM_PROMPT } from "@/lib/ai/prompts/release";
import { buildReleaseContext } from "@/features/intelligence/release-context";
import { formatIssueKey } from "@/lib/issues";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { projectId?: string; milestoneId?: string | null; versionId?: string | null } | null;
    const projectId = typeof body?.projectId === "string" ? body.projectId : null;
    const milestoneId = typeof body?.milestoneId === "string" && body.milestoneId ? body.milestoneId : null;
    const versionId = typeof body?.versionId === "string" && body.versionId ? body.versionId : null;
    if (!projectId) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "projectId is required." }, { status: 400 });
    if (!milestoneId && !versionId) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "milestoneId or versionId is required." }, { status: 400 });

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Authentication required." }, { status: 401 });

    const { data: project } = await supabase.from("projects").select("id, key, name").eq("id", projectId).maybeSingle();
    if (!project) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Project not found." }, { status: 404 });

    const isMember = await supabase.rpc("is_project_member" as never, { p_project_id: projectId } as never);
    if (isMember.error || !isMember.data) return NextResponse.json({ code: "AI_CONTEXT_UNAVAILABLE", message: "Not a project member." }, { status: 403 });

    let milestoneName: string | null = null;
    let versionName: string | null = null;
    if (milestoneId) {
      const { data: milestone } = await supabase.from("milestones").select("name").eq("id", milestoneId).eq("project_id", projectId).maybeSingle();
      milestoneName = (milestone as { name?: string } | null)?.name ?? null;
    }
    if (versionId) {
      const { data: version } = await supabase.from("versions").select("name").eq("id", versionId).eq("project_id", projectId).maybeSingle();
      versionName = (version as { name?: string } | null)?.name ?? null;
    }

    const issueRows: Array<Record<string, unknown>> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("issues")
        .select("id, issue_number, title, type, priority, severity, target_milestone_id, affected_version_id, status:workflow_states(name, category), component:components(name)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      if (error) break;
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      issueRows.push(...rows);
      if (rows.length < 1000) break;
    }

    const filtered = issueRows.filter((row) => {
      if (milestoneId && (row as { target_milestone_id: string | null }).target_milestone_id !== milestoneId) return false;
      if (versionId && (row as { affected_version_id: string | null }).affected_version_id !== versionId) return false;
      return true;
    });

    const visible: Array<Record<string, unknown>> = [];
    for (const row of filtered) {
      const { data: canView } = await supabase.rpc("can_view_issue" as never, { p_issue_id: (row as { id: string }).id } as never);
      if (canView) visible.push(row);
    }

    const total = visible.length;
    const resolved = visible.filter((row) => ((row as { status: { category: string } | null }).status?.category ?? "OPEN") === "RESOLVED" || ((row as { status: { category: string } | null }).status?.category ?? "") === "CLOSED").length;
    let score = total === 0 ? 100 : Math.round((resolved / total) * 100);
    const open = visible.filter((row) => {
      const category = ((row as { status: { category: string } | null }).status?.category ?? "OPEN") as string;
      return category !== "RESOLVED" && category !== "CLOSED";
    });
    const blockers = open.filter((row) => (row as { priority: string }).priority === "P0" || (row as { severity: string }).severity === "BLOCKER");
    const criticals = open.filter((row) => ((row as { priority: string }).priority === "P1" || (row as { severity: string }).severity === "CRITICAL") && !blockers.includes(row));
    const regressions = open.filter((row) => (row as { type: string }).type === "REGRESSION");
    const security = open.filter((row) => (row as { type: string }).type === "SECURITY");
    if (total > 0) {
      score -= blockers.length * 25;
      score -= criticals.length * 10;
      score -= regressions.length * 15;
      score = Math.max(0, Math.min(100, score));
      if (blockers.length === 0 && criticals.length === 0 && open.length === 0) score = 100;
    }

    const topIssues = visible.slice(0, 8).map((row) => ({
      id: (row as { id: string }).id,
      keyLabel: formatIssueKey((project as { key: string }).key, (row as { issue_number: number }).issue_number),
      title: (row as { title: string }).title,
      type: (row as { type: string }).type,
      priority: (row as { priority: string }).priority,
      severity: (row as { severity: string }).severity,
      statusCategory: ((row as { status: { category: string } | null }).status?.category ?? "OPEN") as string,
      componentName: ((row as { component: { name: string } | null }).component?.name ?? null) as string | null,
    }));

    const context = buildReleaseContext({
      milestoneName,
      versionName,
      readinessScore: score,
      blockerCount: blockers.length,
      criticalCount: criticals.length,
      regressionCount: regressions.length,
      securityCount: security.length,
      totalCount: total,
      resolvedCount: resolved,
      topIssues,
    });

    const redacted = redactObject(context);
    const inputHash = canonicalHash({ ...redacted, projectId, milestoneId, versionId }, AI_MODEL);

    const cached = await lookupAiCache({ feature: "RELEASE", projectId, inputHash, milestoneId });
    if (cached) {
      const parsedCached = releaseBriefSchema.safeParse(cached);
      if (parsedCached.success) return NextResponse.json({ data: parsedCached.data, cached: true });
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ code: "AI_NOT_CONFIGURED", message: "Trace AI is not configured." }, { status: 503 });
    }

    const raw = await groqJson<unknown>({ systemPrompt: RELEASE_SYSTEM_PROMPT, userPayload: redacted });
    const parsed = releaseBriefSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ code: "AI_INVALID_RESPONSE", message: "Trace AI returned an invalid response." }, { status: 502 });
    }

    const allowedKeys = new Set(topIssues.map((issue) => issue.keyLabel));
    const sanitized = {
      ...parsed.data,
      primary_risks: parsed.data.primary_risks.filter((risk) => allowedKeys.has(risk.issue_key)),
    };

    await storeAiCache({ feature: "RELEASE", projectId, inputHash, milestoneId, model: AI_MODEL, result: sanitized });

    return NextResponse.json({ data: sanitized, cached: false });
  } catch (error) {
    if (error instanceof AiError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    console.error("release intelligence error", error);
    return NextResponse.json({ code: "AI_PROVIDER_ERROR", message: "Trace AI is temporarily unavailable." }, { status: 502 });
  }
}
