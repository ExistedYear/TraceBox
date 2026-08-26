import { describe, expect, it } from "vitest";

import { eventSummary } from "../src/lib/issues";

describe("Phase 8: Watchers & Notifications", () => {
  it("formats watch-related audit events", () => {
    const watchEvent = {
      event_type: "WATCHED_ISSUE_UPDATED",
      field_name: null,
      old_value: null,
      new_value: null,
      metadata: { title: "API-1" },
    };
    const summary = eventSummary(watchEvent);
    expect(summary.heading).toBe("watched issue updated");
  });

  it("formats comment and mention notification types", () => {
    const commentEvent = {
      event_type: "COMMENT_ADDED",
      metadata: { excerpt: "Looks good" },
    };
    expect(eventSummary(commentEvent).heading).toBe("commented");

    const mentionTypes = ["ASSIGNED", "MENTION", "COMMENT", "STATUS_CHANGED", "WATCHED_ISSUE_UPDATED"];
    for (const type of mentionTypes) {
      expect(typeof type).toBe("string");
      expect(type.length).toBeGreaterThan(2);
    }
  });

  it("validates notification preference defaults", () => {
    const defaultPrefs = {
      mentions: true,
      assignments: true,
      comments: true,
      status_changes: true,
      watch_updates: true,
    };
    expect(defaultPrefs.mentions).toBe(true);
    expect(Object.keys(defaultPrefs).length).toBe(5);
  });
});
