export const ISSUE_TYPES = ["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
export const SEVERITIES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"] as const;
export const RESOLUTIONS = ["FIXED", "DUPLICATE", "WONT_FIX", "INVALID", "CANNOT_REPRODUCE", "WORKS_AS_EXPECTED"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export function formatIssueKey(projectKey: string, issueNumber: number) {
  return `${projectKey.toUpperCase()}-${issueNumber}`;
}

export function parseIssueKey(param: string): { projectKey: string; issueNumber: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(param.trim());
  if (!match || match[2].length > 15) return null;
  const issueNumber = Number(match[2]);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return null;
  return { projectKey: match[1].toUpperCase(), issueNumber };
}

// Maps an immutable audit event to human timeline copy; never renders raw JSON.
export function eventSummary(
  event: {
    event_type: string;
    field_name?: string | null;
    old_value?: unknown;
    new_value?: unknown;
    metadata?: unknown;
  },
  resolveId?: (id: string) => string,
): { heading: string; detail?: string } {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  const label = (value: unknown) =>
    value === null || value === undefined || value === ""
      ? "—"
      : resolveId && typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)
        ? resolveId(value)
        : String(value);
  switch (event.event_type) {
    case "ISSUE_CREATED":
      return { heading: "created this issue", detail: typeof meta.title === "string" ? meta.title : undefined };
    case "STATUS_CHANGED":
      return { heading: "changed status", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "ASSIGNEE_CHANGED":
      return { heading: "changed assignee", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "PRIORITY_CHANGED":
      return { heading: "changed priority", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "SEVERITY_CHANGED":
      return { heading: "changed severity", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "TYPE_CHANGED":
      return { heading: "changed type", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "COMPONENT_CHANGED":
      return { heading: "changed component", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "RESOLUTION_CHANGED":
      return { heading: "set resolution", detail: label(event.new_value) };
    case "TITLE_CHANGED":
      return { heading: "renamed the issue", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "COMMENT_ADDED":
      return {
        heading: "commented",
        detail: typeof meta.excerpt === "string" && meta.excerpt ? meta.excerpt : undefined,
      };
    case "COMMENT_EDITED":
      return { heading: "edited a comment" };
    case "ISSUE_LINKED":
      return {
        heading: "linked issue",
        detail:
          typeof meta.relationship === "string" && typeof event.new_value === "string"
            ? `${meta.relationship.toLowerCase().replaceAll("_", " ")} ${event.new_value}`
            : typeof event.new_value === "string"
              ? event.new_value
              : undefined,
      };
    case "ISSUE_UNLINKED":
      return {
        heading: "unlinked issue",
        detail:
          typeof meta.relationship === "string" && typeof event.old_value === "string"
            ? `${meta.relationship.toLowerCase().replaceAll("_", " ")} ${event.old_value}`
            : typeof event.old_value === "string"
              ? event.old_value
              : undefined,
      };
    default:
      return { heading: event.event_type.toLowerCase().replaceAll("_", " ") };
  }
}

export function excerptBody(body: string, max = 200) {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

export type TimelineComment = {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  edited_at: string | null;
  created_at: string;
};

export type TimelineEventRow = {
  id: string;
  issue_id: string;
  actor_id: string | null;
  event_type: string;
  field_name: string | null;
  old_value: unknown;
  new_value: unknown;
  metadata: unknown;
  created_at: string;
};

export type UnifiedTimelineEntry =
  | { kind: "comment"; at: string; comment: TimelineComment }
  | { kind: "event"; at: string; event: TimelineEventRow };

export function buildTimeline(events: TimelineEventRow[], comments: TimelineComment[]): UnifiedTimelineEntry[] {
  const entries: UnifiedTimelineEntry[] = [
    ...events.map((event) => ({ kind: "event" as const, at: event.created_at, event })),
    ...comments.map((comment) => ({ kind: "comment" as const, at: comment.created_at, comment })),
  ];
  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return entries;
}

// Lightweight inline helpers for comment bodies: detect @mentions and KEY-N refs.
// They are rendered as styled spans rather than raw HTML to avoid XSS.
export function tokenizeCommentBody(body: string): { text: string; kind: "text" | "mention" | "issue-ref" }[] {
  const tokens: { text: string; kind: "text" | "mention" | "issue-ref" }[] = [];
  const re = /(@[a-zA-Z0-9._-]+|[A-Z][A-Z0-9]+-\d+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) tokens.push({ text: body.slice(lastIndex, match.index), kind: "text" });
    const value = match[0];
    if (value.startsWith("@")) tokens.push({ text: value, kind: "mention" });
    else tokens.push({ text: value, kind: "issue-ref" });
    lastIndex = match.index + value.length;
  }
  if (lastIndex < body.length) tokens.push({ text: body.slice(lastIndex), kind: "text" });
  if (tokens.length === 0) tokens.push({ text: body, kind: "text" });
  return tokens;
}


// Tailwind classes per workflow category; mirrors the Geist reference pill system.
export function categoryClasses(category: string) {
  switch (category) {
    case "TRIAGE":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "OPEN":
      return "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "IN_PROGRESS":
      return "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "REVIEW":
      return "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300";
    case "RESOLVED":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "CLOSED":
      return "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export type IssueFilters = {
  statusId?: string;
  priority?: string;
  severity?: string;
  type?: string;
  componentId?: string;
  assigneeId?: string;
};


export function encodeIssueFilters(filters: IssueFilters): Record<string, string> {
  const result: Record<string, string> = {};
  if (filters.statusId) result.status = filters.statusId;
  if (filters.componentId) result.component = filters.componentId;
  if (filters.assigneeId) result.assignee = filters.assigneeId;
  if (filters.priority) result.priority = filters.priority;
  if (filters.severity) result.severity = filters.severity;
  if (filters.type) result.type = filters.type;
  return result;
}

export function decodeIssueSearchParams(
  params: Record<string, string | string[] | undefined>,
  valid: { stateIds: Set<string>; componentIds: Set<string>; memberIds?: Set<string> },
): IssueFilters {
  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = params[name];
      if (typeof value === "string" && value !== "") return value;
    }
    return undefined;
  };
  const statusId = pick("status", "statusId");
  const componentId = pick("component", "componentId");
  const assigneeId = pick("assignee", "assigneeId");
  const priority = PRIORITIES.find((value) => value === pick("priority"));
  const severity = SEVERITIES.find((value) => value === pick("severity"));
  const type = ISSUE_TYPES.find((value) => value === pick("type"));
  return {
    statusId: statusId && valid.stateIds.has(statusId) ? statusId : undefined,
    priority,
    severity,
    type,
    componentId: componentId && valid.componentIds.has(componentId) ? componentId : undefined,
    assigneeId: assigneeId && (!valid.memberIds || valid.memberIds.has(assigneeId)) ? assigneeId : undefined,
  };
}

function labelOf(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function personLabel(displayName: string | undefined | null, userId: string | null | undefined) {
  if (displayName) return displayName;
  if (!userId) return "—";
  return `user-${userId.slice(0, 6)}`;
}
