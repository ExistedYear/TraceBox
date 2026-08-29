import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/202608260062_phase12_mentions.sql", import.meta.url), "utf8");

describe("Phase 12 stable mention database contract", () => {
  it("stores identity plus exact display labels and keeps writes RPC-only", () => {
    expect(migration).toContain("create table if not exists public.comment_mentions");
    expect(migration).toContain("primary key (comment_id, user_id)");
    expect(migration).toContain("display_label text not null");
    expect(migration).toContain("mention_token text not null");
    expect(migration).toContain("revoke insert, update, delete on public.comment_mentions");
    expect(migration).toContain("create index if not exists comment_mentions_user_idx");
    expect(migration).toContain('create policy "Users can read visible comment mentions"');
  });

  it("uses member-aware autocomplete and atomic selected-identity wrappers", () => {
    expect(migration).toContain("function public.list_project_mention_candidates");
    expect(migration).toContain("p_issue_id uuid default null");
    expect(migration).toContain("function public.add_comment_with_mentions");
    expect(migration).toContain("function public.edit_comment_with_mentions");
    expect(migration).toContain("p_mentioned_user_ids uuid[] default null");
    expect(migration).toContain("notification_recipient_can_view_issue");
    expect(migration).toContain("cardinality(v_ids) > 20");
    expect(migration).toContain("Comment must visibly include every selected mention");
  });

  it("removes regex-derived notifications and notifies only inserted relation rows", () => {
    expect(migration).toContain("drop trigger if exists trg_comment_mentions_notifications");
    expect(migration).toContain("drop function if exists public.on_comment_mentions_notifications()");
    expect(migration).toContain("v_added_ids");
    expect(migration).toContain("where cm.comment_id = p_comment_id and cm.user_id = any(v_added_ids)");
    expect(migration).toContain("public.dispatch_issue_notification(");
    expect(migration).toContain("normalize_mention_token");
  });
});
