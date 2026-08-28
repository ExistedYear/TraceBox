import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Webhook cleanup is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { data, error } = await (createAdminClient() as any).rpc("cleanup_github_webhook_payloads");
  if (error) {
    console.error("GitHub webhook cleanup failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Could not clean webhook payloads." }, { status: 500 });
  }
  return NextResponse.json({ success: true, cleared: Number(data ?? 0) });
}
