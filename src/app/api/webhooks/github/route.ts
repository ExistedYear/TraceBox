import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";
import { processGithubWebhookDelivery } from "@/lib/github-webhook-processor";

function isValidSignature(body: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const provided = Buffer.from(signature.slice(7), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  const body = await request.text();
  if (!isValidSignature(body, request.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  if (!deliveryId || !event) return NextResponse.json({ error: "Missing GitHub webhook headers." }, { status: 400 });

  let payload: any;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const action = typeof payload.action === "string" ? payload.action : null;
  const repositoryId = Number(payload.repository?.id);
  const installationId = Number(payload.installation?.id);
  const admin = createAdminClient() as any;
  const { data: delivery, error: deliveryError } = await admin.rpc("record_github_webhook_delivery", {
    p_delivery_id: deliveryId,
    p_event_name: event,
    p_action: action,
    p_github_installation_id: Number.isSafeInteger(installationId) ? installationId : null,
    p_github_repository_id: Number.isSafeInteger(repositoryId) ? repositoryId : null,
    p_payload: payload,
  });
  if (deliveryError) {
    console.error("GitHub webhook delivery persistence failed", { code: deliveryError.code, message: deliveryError.message, details: deliveryError.details, hint: deliveryError.hint, deliveryId, event, action, installationId: Number.isSafeInteger(installationId) ? installationId : null, repositoryId: Number.isSafeInteger(repositoryId) ? repositoryId : null });
    return NextResponse.json({ error: "Could not record webhook delivery." }, { status: 500 });
  }
  if (!delivery) return NextResponse.json({ accepted: true, duplicate: true });

  // The row is durable before this best-effort fast path begins. Replay can claim
  // it later if the platform terminates this callback.
  after(() => processGithubWebhookDelivery(deliveryId));
  return NextResponse.json({ accepted: true, queued: true });
}
