import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";
import { replayGithubWebhookDeliveries } from "@/lib/github-webhook-replay";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Webhook replay is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const result = await replayGithubWebhookDeliveries(createAdminClient() as any);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("GitHub webhook replay failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not replay webhook deliveries." }, { status: 500 });
  }
}
