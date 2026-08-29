import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/api-auth";

const BUCKET = "issue-attachments";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Attachment reconciliation is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient();
  const { data: rows, error: rowError } = await admin.rpc("list_missing_attachment_objects");
  if (rowError) {
    console.error("Attachment reconciliation query failed", { code: rowError.code, message: rowError.message });
    return NextResponse.json({ error: "Could not reconcile attachments." }, { status: 500 });
  }
  // Remove DB records whose object disappeared; only the service-role job can
  // do this, and the RPC intentionally returns paths without issue metadata.
  let removedRows = 0;
  let rowDeletionFailures = 0;
  for (const row of rows ?? []) {
    const { error } = await admin.from("attachments").delete().eq("id", row.attachment_id);
    if (!error) removedRows++;
    else rowDeletionFailures++;
  }
  const known = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data: attachmentRows, error } = await admin.from("attachments").select("storage_path").range(offset, offset + 999);
    if (error) {
      console.error("Attachment catalog pagination failed", { code: error.code, message: error.message });
      return NextResponse.json({ error: "Could not reconcile attachments.", removedRows, rowDeletionFailures, removedObjects: 0, removalFailures: 0 }, { status: 500 });
    }
    for (const row of attachmentRows ?? []) known.add(row.storage_path);
    if ((attachmentRows ?? []).length < 1000) break;
  }

  const roots: Array<{ name: string; id: string | null }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error } = await admin.storage.from(BUCKET).list("", { limit: 1000, offset });
    if (error) {
      console.error("Attachment root listing failed", { message: error.message });
      return NextResponse.json({ error: "Could not reconcile attachments.", removedRows, rowDeletionFailures, removedObjects: 0, removalFailures: 0 }, { status: 500 });
    }
    roots.push(...(page ?? []));
    if ((page ?? []).length < 1000) break;
  }

  const orphanPaths: string[] = [];
  for (const root of roots) {
    if (root.id) continue;
    for (let offset = 0; ; offset += 1000) {
      const { data: objects, error } = await admin.storage.from(BUCKET).list(root.name, { limit: 1000, offset });
      if (error) {
        console.error("Attachment object listing failed", { folder: root.name, message: error.message });
        return NextResponse.json({ error: "Could not reconcile attachments.", removedRows, rowDeletionFailures, removedObjects: 0, removalFailures: 0 }, { status: 500 });
      }
      orphanPaths.push(...(objects ?? []).filter((object) => !known.has(`${root.name}/${object.name}`)).map((object) => `${root.name}/${object.name}`));
      if ((objects ?? []).length < 1000) break;
    }
  }
  let removedObjects = 0;
  let removalFailures = 0;
  for (let offset = 0; offset < orphanPaths.length; offset += 100) {
    const batch = orphanPaths.slice(offset, offset + 100);
    const { error } = await admin.storage.from(BUCKET).remove(batch);
    if (error) removalFailures += batch.length;
    else removedObjects += batch.length;
  }
  return NextResponse.json({ success: rowDeletionFailures === 0 && removalFailures === 0, removedRows, rowDeletionFailures, removedObjects, removalFailures, catalogComplete: true });
}
