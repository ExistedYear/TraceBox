import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260056_phase10_attachments.sql", import.meta.url), "utf8");
const component = readFileSync(new URL("../src/components/issues/issue-attachments-section.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/attachments/reconcile/route.ts", import.meta.url), "utf8");

describe("Phase 10 attachment recovery contract", () => {
  it("enforces private attachment metadata at the database boundary", () => {
    expect(migration).toContain("validate_attachment_metadata");
    expect(migration).toContain("Unsupported attachment MIME type");
    expect(migration).toContain("52428800");
    expect(migration).toContain("list_missing_attachment_objects");
    expect(migration).toContain("metadata->>'mimetype'");
    expect(migration).toContain("metadata is not null");
    expect(migration).toContain("public.can_view_issue(public.issue_id_from_storage_path(name))");
    expect(migration).toContain("public.can_comment_on_issue(public.issue_id_from_storage_path(name))");
  });

  it("supports drag/drop, progress, cancellation, retry, and MIME filtering", () => {
    expect(component).toContain("onDrop");
    expect(component).toContain("xhr.upload.onprogress");
    expect(component).toContain("AbortController");
    expect(component).toContain("Retry");
    expect(component).toContain("ALLOWED_MIME_TYPES");
  });

  it("protects orphan cleanup behind the cron secret and service role", () => {
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain("createAdminClient");
    expect(route).toContain("list_missing_attachment_objects");
    expect(route).toContain("storage.from(BUCKET).remove");
    expect(route).toContain(".range(offset, offset + 999)");
    expect(route).toContain("catalogComplete: true");
    expect(route).toContain("offset += 100");
    expect(route).toContain("rowDeletionFailures");
    expect(route).toContain("rowDeletionFailures === 0 && removalFailures === 0");
    expect(route).toContain("Could not reconcile attachments.");
    expect(route).toContain("removedObjects: 0");
    expect(route).toContain("status: 500");
  });
});
