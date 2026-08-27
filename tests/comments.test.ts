import { describe, expect, it } from "vitest";

import { buildTimeline, eventSummary, excerptBody, tokenizeCommentBody } from "../src/lib/issues";
import { commentSchema } from "../src/lib/validation/comment";

describe("commentSchema", () => {
  it("accepts trimmed body within limits", () => {
    expect(commentSchema.safeParse({ body: "Hello world" }).success).toBe(true);
    expect(commentSchema.safeParse({ body: "  trimmed  " }).data?.body).toBe("trimmed");
  });

  it("rejects empty or oversized bodies", () => {
    expect(commentSchema.safeParse({ body: "" }).success).toBe(false);
    expect(commentSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(commentSchema.safeParse({ body: "a".repeat(10001) }).success).toBe(false);
  });

  it("accepts max 10k characters", () => {
    expect(commentSchema.safeParse({ body: "a".repeat(10000) }).success).toBe(true);
  });
});

describe("eventSummary comment events", () => {
  it("describes COMMENT_ADDED with excerpt", () => {
    const summary = eventSummary({ event_type: "COMMENT_ADDED", metadata: { excerpt: "Looks related to TRACE-1" } });
    expect(summary.heading).toBe("commented");
    expect(summary.detail).toBe("Looks related to TRACE-1");
  });

  it("describes COMMENT_EDITED without detail", () => {
    expect(eventSummary({ event_type: "COMMENT_EDITED" })).toEqual({ heading: "edited a comment" });
  });

  it("describes core field changes with old and new values", () => {
    expect(eventSummary({ event_type: "TITLE_CHANGED", old_value: "Old title", new_value: "New title" })).toEqual({
      heading: "renamed the issue",
      detail: "Old title → New title",
    });
    expect(eventSummary({ event_type: "STATUS_CHANGED", old_value: "Triage", new_value: "Open" })).toEqual({
      heading: "changed status",
      detail: "Triage → Open",
    });
    expect(eventSummary({ event_type: "RESOLUTION_CHANGED", new_value: "FIXED" })).toEqual({
      heading: "set resolution",
      detail: "FIXED",
    });
  });
});

describe("excerptBody", () => {
  it("returns trimmed body when under limit", () => {
    expect(excerptBody("  hello  ")).toBe("hello");
  });
  it("truncates with ellipsis", () => {
    const body = "a".repeat(250);
    expect(excerptBody(body, 200)).toBe(`${"a".repeat(200)}…`);
  });
});

describe("tokenizeCommentBody", () => {
  it("splits mentions and issue refs", () => {
    const tokens = tokenizeCommentBody("Hey @neeraj see TRACE-141 and WEB-1");
    expect(tokens).toEqual([
      { text: "Hey ", kind: "text" },
      { text: "@neeraj", kind: "mention" },
      { text: " see ", kind: "text" },
      { text: "TRACE-141", kind: "issue-ref" },
      { text: " and ", kind: "text" },
      { text: "WEB-1", kind: "issue-ref" },
    ]);
  });

  it("returns single text token for plain bodies", () => {
    expect(tokenizeCommentBody("plain text")).toEqual([{ text: "plain text", kind: "text" }]);
  });
  it("handles complex mentions with dots and hyphens and punctuation", () => {
    const tokens = tokenizeCommentBody("cc @adithya.k and @team-lead (see TRACE-1)");
    expect(tokens).toEqual([
      { text: "cc ", kind: "text" },
      { text: "@adithya.k", kind: "mention" },
      { text: " and ", kind: "text" },
      { text: "@team-lead", kind: "mention" },
      { text: " (see ", kind: "text" },
      { text: "TRACE-1", kind: "issue-ref" },
      { text: ")", kind: "text" },
    ]);
  });

  it("handles multiple consecutive issue keys and mixed tokens", () => {
    const tokens = tokenizeCommentBody("Fixed in AUTH-42 and verified in CORE-100 by @alice!");
    expect(tokens).toEqual([
      { text: "Fixed in ", kind: "text" },
      { text: "AUTH-42", kind: "issue-ref" },
      { text: " and verified in ", kind: "text" },
      { text: "CORE-100", kind: "issue-ref" },
      { text: " by ", kind: "text" },
      { text: "@alice", kind: "mention" },
      { text: "!", kind: "text" },
    ]);
  });

  it("handles empty bodies", () => {
    expect(tokenizeCommentBody("")).toEqual([{ text: "", kind: "text" }]);
  });
});

describe("buildTimeline", () => {
  it("merges events and comments chronologically", () => {
    const events = [
      { id: "e1", issue_id: "i1", actor_id: null, event_type: "ISSUE_CREATED", field_name: null, old_value: null, new_value: null, metadata: {}, created_at: "2026-01-01T09:00:00Z" },
      { id: "e2", issue_id: "i1", actor_id: null, event_type: "PRIORITY_CHANGED", field_name: "priority", old_value: "P2", new_value: "P1", metadata: null, created_at: "2026-01-01T10:00:00Z" },
    ];
    const comments = [
      { id: "c1", issue_id: "i1", author_id: "u1", body: "hello", edited_at: null, created_at: "2026-01-01T09:30:00Z" },
    ];
    const timeline = buildTimeline(events, comments);
    expect(timeline.map((e) => (e.kind === "event" ? e.event.id : e.comment.id))).toEqual(["e1", "c1", "e2"]);
  });

  it("handles empty inputs", () => {
    expect(buildTimeline([], [])).toEqual([]);
    expect(buildTimeline([], [{ id: "c1", issue_id: "i1", author_id: "u1", body: "x", edited_at: null, created_at: "2026-01-01T00:00:00Z" }]).length).toBe(1);
  });
});
