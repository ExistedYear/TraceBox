import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELIVERY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * Retry is deliberately delegated to the database contract. The RPC owns
 * project isolation, the bounded attempt budget, idempotent claiming, and
 * queueing; this route never reads webhook payloads or invokes the processor.
 */
export async function POST(request: NextRequest) {
  let body: { project_id?: unknown; delivery_id?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const projectId = typeof body.project_id === "string" ? body.project_id : "";
  const deliveryId = typeof body.delivery_id === "string" ? body.delivery_id.trim() : "";
  if (!UUID_RE.test(projectId) || !DELIVERY_RE.test(deliveryId)) return NextResponse.json({ error: "Valid project_id and delivery_id are required." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED", error: "Authentication required." }, { status: 401 });
  const { data: project } = await supabase.from("projects").select("id, is_archived").eq("id", projectId).maybeSingle();
  if (!project) return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "Project not found." }, { status: 404 });
  if (project.is_archived) return NextResponse.json({ code: "PROJECT_ARCHIVED", error: "Archived projects cannot retry GitHub deliveries." }, { status: 409 });
  const { data: role } = await supabase.rpc("project_role", { p_project_id: projectId });
  if (role !== "MAINTAINER") return NextResponse.json({ code: "MAINTAINER_REQUIRED", error: "Only Maintainers can retry GitHub deliveries." }, { status: 403 });

  const { data, error } = await (supabase as any).rpc("request_github_webhook_retry", { p_project_id: projectId, p_delivery_id: deliveryId });
  if (error) {
    console.error("GitHub webhook retry failed", { code: error.code, message: error.message, projectId, deliveryId });
    const code = error.code === "P0002" ? "NOT_FOUND" : error.code === "42501" ? "NOT_RETRYABLE" : "RETRY_UNAVAILABLE";
    return NextResponse.json({ code, error: code === "NOT_RETRYABLE" ? "This delivery is no longer eligible for retry." : "This delivery could not be retried." }, { status: code === "NOT_FOUND" ? 404 : 409 });
  }
  return NextResponse.json({ success: true, queued: true, request: Array.isArray(data) ? data[0] ?? null : null });
}
