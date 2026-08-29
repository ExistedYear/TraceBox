import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationHref,
  notificationLabel,
  notificationPageFromRows,
} from "../src/lib/notifications";

const migration = readFileSync(new URL("../supabase/migrations/202608260048_phase6_notifications.sql", import.meta.url), "utf8");

describe("Phase 6 notification contract", () => {
  it("uses authenticated cursor paging and exact visibility-aware unread counts", () => {
    expect(migration).toContain("function public.list_notifications");
    expect(migration).toContain("p_cursor_created_at timestamptz");
    expect(migration).toContain("public.can_view_issue(n.issue_id)");
    expect(migration).toContain("function public.get_unread_notifications_count");
    expect(migration).toContain("raise exception 'AUTH_REQUIRED'");
  });

  it("keeps restricted payloads generic and dispatcher access-aware", () => {
    expect(migration).toContain("notification_recipient_can_view_issue");
    expect(migration).toContain("jsonb_build_object('restricted', true)");
    expect(migration).toContain("p_recipient_id = p_actor_id");
    expect(migration).toContain("revoke execute on function public.dispatch_issue_notification");
    expect(migration).toContain("drop policy if exists \"Users can update their notification preferences\"");
    expect(migration).toContain("drop policy if exists \"Users can insert their notification preferences\"");
  });

  it("covers every retained preference-aware category and no email contract", () => {
    for (const type of ["ASSIGNED", "MENTION", "COMMENT", "STATUS_CHANGED", "ISSUE_LINKED", "LABEL_CHANGED", "PLANNING_CHANGED", "MILESTONE_CHANGED", "WATCHED_ISSUE_UPDATED"]) {
      expect(migration).toContain(`'${type}'`);
    }
    expect(migration).toContain("in-app only");
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)).toHaveLength(9);
    expect(migration).toContain("trg_milestone_changed_notifications");
    expect(migration).toContain("trg_version_changed_notifications");
    expect(migration).toContain("after insert or update of body on public.comments");
  });

  it("builds a safe cursor and rejects malformed issue links", () => {
    const page = notificationPageFromRows([
      {
        id: "n1", issue_id: "i1", type: "COMMENT", data: {}, actor_id: null,
        actor_name: "Ada", issue_number: 7, project_key: "CORE", issue_title: "Fix",
        read_at: null, created_at: "2026-08-28T00:00:00Z", next_cursor_created_at: "2026-08-28T00:00:00Z", next_cursor_id: "n1", has_more: true,
      },
    ]);
    expect(page.nextCursor).toEqual({ createdAt: "2026-08-28T00:00:00Z", id: "n1" });
    expect(notificationHref(page.items[0])).toBe("/dashboard/issues/CORE-7");
    expect(notificationHref({ ...page.items[0], project_key: "bad key" })).toBeNull();
    expect(notificationLabel("ISSUE_LINKED")).toContain("linked");
  });
});
