import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  decodeIssueSearchParams,
  encodeIssueFilters,
  eventSummary,
  excerptBody,
  formatIssueKey,
  ISSUE_TYPES,
  parseIssueKey,
  PRIORITIES,
  SEVERITIES,
  tokenizeCommentBody,
  type TimelineComment,
  type TimelineEventRow,
} from "../src/lib/issues";
import { slugify } from "../src/lib/utils";
import { commentSchema } from "../src/lib/validation/comment";
import { componentSchema } from "../src/lib/validation/components";
import { issueCreateSchema } from "../src/lib/validation/issue";
import { projectSchema, workspaceSchema } from "../src/lib/validation/workspace";

describe("Phase 1–5 Integration Flow", () => {
  it("executes the full workspace -> project -> component -> issue -> filter -> comment -> timeline lifecycle", () => {
    // 1. Phase 1: Workspace creation & slug derivation
    const rawWorkspace = { name: "TraceBox Core Org", slug: "tracebox-core-org" };
    expect(slugify(rawWorkspace.name)).toBe(rawWorkspace.slug);
    const wsResult = workspaceSchema.safeParse(rawWorkspace);
    expect(wsResult.success).toBe(true);

    // Project creation & key normalization
    const rawProject = { name: "Platform API", key: "api", description: "Backend platform service" };
    const projResult = projectSchema.safeParse(rawProject);
    expect(projResult.success).toBe(true);
    expect(projResult.data?.key).toBe("API");

    // 2. Phase 2: Component management
    const rawComponent = { name: "Authentication", description: "OAuth & JWT tokens", default_assignee_id: "" };
    const compResult = componentSchema.safeParse(rawComponent);
    expect(compResult.success).toBe(true);

    const componentId = "11111111-1111-4111-8111-111111111111";

    // 3. Phase 3: Issue creation
    const rawIssue = {
      title: "Token refresh returns 401 intermittently",
      type: "BUG",
      priority: "P1",
      severity: "CRITICAL",
      description: "When session expires during token exchange, refresh returns 401.",
      component_id: componentId,
      steps_to_reproduce: "1. Let token expire\n2. Call refresh endpoint",
      expected_behavior: "Returns renewed token",
      actual_behavior: "Returns 401 Unauthorized",
    };
    const issueResult = issueCreateSchema.safeParse(rawIssue);
    expect(issueResult.success).toBe(true);

    const issueNumber = 1;
    const issueKey = formatIssueKey(projResult.data!.key, issueNumber);
    expect(issueKey).toBe("API-1");
    expect(parseIssueKey(issueKey)).toEqual({ projectKey: "API", issueNumber: 1 });

    // 4. Phase 4: TanStack issue queue filters and inline edits
    const activeFilters = {
      statusId: "s-open",
      componentId,
      priority: "P1" as (typeof PRIORITIES)[number],
      severity: "CRITICAL" as (typeof SEVERITIES)[number],
      type: "BUG" as (typeof ISSUE_TYPES)[number],
    };
    const encodedParams = encodeIssueFilters(activeFilters);
    expect(encodedParams).toEqual({
      status: "s-open",
      component: componentId,
      priority: "P1",
      severity: "CRITICAL",
      type: "BUG",
    });

    const validStateIds = new Set(["s-triage", "s-open", "s-in-progress", "s-resolved", "s-closed"]);
    const validComponentIds = new Set([componentId]);
    const decodedFilters = decodeIssueSearchParams(encodedParams, {
      stateIds: validStateIds,
      componentIds: validComponentIds,
    });
    expect(decodedFilters).toEqual(activeFilters);

    // 5. Phase 5: Comments, tokenization, and unified activity timeline
    const rawComment = {
      body: "Investigating this now. CC @adithya.k — looks related to API-1 and AUTH-42.",
    };
    const commentParsed = commentSchema.safeParse(rawComment);
    expect(commentParsed.success).toBe(true);

    const tokens = tokenizeCommentBody(commentParsed.data!.body);
    expect(tokens).toEqual([
      { text: "Investigating this now. CC ", kind: "text" },
      { text: "@adithya.k", kind: "mention" },
      { text: " — looks related to ", kind: "text" },
      { text: "API-1", kind: "issue-ref" },
      { text: " and ", kind: "text" },
      { text: "AUTH-42", kind: "issue-ref" },
      { text: ".", kind: "text" },
    ]);

    expect(excerptBody(commentParsed.data!.body, 30)).toBe("Investigating this now. CC @ad…");

    // Unified timeline construction
    const events: TimelineEventRow[] = [
      {
        id: "evt-1",
        issue_id: "issue-1",
        actor_id: "user-1",
        event_type: "ISSUE_CREATED",
        field_name: null,
        old_value: null,
        new_value: null,
        metadata: { title: rawIssue.title },
        created_at: "2026-08-26T10:00:00Z",
      },
      {
        id: "evt-2",
        issue_id: "issue-1",
        actor_id: "user-1",
        event_type: "STATUS_CHANGED",
        field_name: "status",
        old_value: "Triage",
        new_value: "In Progress",
        metadata: null,
        created_at: "2026-08-26T10:05:00Z",
      },
    ];

    const comments: TimelineComment[] = [
      {
        id: "cmt-1",
        issue_id: "issue-1",
        author_id: "user-2",
        body: commentParsed.data!.body,
        edited_at: null,
        created_at: "2026-08-26T10:10:00Z",
      },
    ];

    const timeline = buildTimeline(events, comments);
    expect(timeline.length).toBe(3);
    expect(timeline.map((entry) => (entry.kind === "event" ? entry.event.id : entry.comment.id))).toEqual([
      "evt-1",
      "evt-2",
      "cmt-1",
    ]);

    // Audit event human-readable summaries
    expect(eventSummary(events[0])).toEqual({
      heading: "created this issue",
      detail: rawIssue.title,
    });
    expect(eventSummary(events[1])).toEqual({
      heading: "changed status",
      detail: "Triage → In Progress",
    });
  });
});
