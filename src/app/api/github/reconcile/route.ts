import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";
import { syncGithubInstallation } from "@/lib/github-repository-sync";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Reconciliation is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: installations, error } = await admin.from("github_installations").select("id, github_installation_id, status").neq("status", "REVOKED");
  if (error) return NextResponse.json({ error: "Could not load GitHub installations." }, { status: 500 });
  let synced = 0;
  let failed = 0;
  for (const installation of installations ?? []) {
    const result = await syncGithubInstallation(admin, installation);
    synced += result.synced;
    failed += result.failed;
  }
  return NextResponse.json({ success: true, installations: installations?.length ?? 0, synced, failed });
}
