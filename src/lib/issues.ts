export const ISSUE_TYPES = ["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
export const SEVERITIES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"] as const;
const ISSUE_TYPE_LABELS: Record<string, string> = { BUG: "Bug", ENHANCEMENT: "Enhancement", TASK: "Task", SECURITY: "Security", PERFORMANCE: "Performance", REGRESSION: "Regression" };
const PRIORITY_LABELS: Record<string, string> = { P0: "P0 · Urgent", P1: "P1 · High", P2: "P2 · Normal", P3: "P3 · Low", P4: "P4 · Lowest" };

export function humanizeEnum(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function issueTypeLabel(value: string): string {
  return ISSUE_TYPE_LABELS[value] ?? humanizeEnum(value);
}

export function priorityLabel(value: string): string {
  return PRIORITY_LABELS[value] ?? value;
}

export function severityLabel(value: string): string {
  return humanizeEnum(value);
}
export const RESOLUTIONS = ["FIXED", "DUPLICATE", "WONT_FIX", "INVALID", "CANNOT_REPRODUCE", "WORKS_AS_EXPECTED"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const WORKFLOW_CATEGORIES = ["TRIAGE", "OPEN", "IN_PROGRESS", "REVIEW", "RESOLVED", "CLOSED"] as const;
export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

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
    case "VERSION_CHANGED":
      return { heading: "changed affected version", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "MILESTONE_CHANGED":
      return { heading: "changed target milestone", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "CUSTOM_FIELD_UPDATED":
      return { heading: "updated custom field", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
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
            : typeof meta.relationship === "string" && event.new_value && typeof event.new_value === "object" && "canonical_issue_number" in event.new_value && typeof event.new_value.canonical_issue_number === "number"
              ? `${meta.relationship.toLowerCase().replaceAll("_", " ")} issue #${event.new_value.canonical_issue_number}`
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
    case "GITHUB_LINKED":
      return { heading: "linked GitHub work", detail: typeof event.new_value === "string" ? event.new_value : typeof meta.relationship === "string" ? meta.relationship : undefined };
    case "GITHUB_LINK_UPDATED":
      return { heading: "updated GitHub relationship", detail: `${label(event.old_value)} → ${label(event.new_value)}` };
    case "GITHUB_LINK_REMOVED":
      return { heading: "removed an automatic GitHub link" };
    case "GITHUB_PR_MERGED":
      return { heading: "merged a GitHub pull request", detail: typeof meta.title === "string" ? meta.title : undefined };
    case "GITHUB_CHECKS_PASSED":
      return { heading: "GitHub checks passed" };
    case "GITHUB_CHECKS_FAILED":
      return { heading: "GitHub checks failed" };
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
  statusCategories?: WorkflowCategory[];
  priority?: string;
  severity?: string;
  type?: string;
  visibility?: "PROJECT" | "RESTRICTED";
  componentId?: string;
  assigneeId?: string;
  reporterId?: string;
  resolution?: Resolution;
  versionId?: string;
  milestoneId?: string;
  labelId?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  customFieldId?: string;
  customFieldValue?: string;
  unresolved?: boolean;
  overdue?: boolean;
  critical?: boolean;
};
export const CUSTOM_FIELD_FILTER_MAX = 200;


export function encodeIssueFilters(filters: IssueFilters): Record<string, string> {
  const result: Record<string, string> = {};
  if (filters.statusId) result.status = filters.statusId;
  if (filters.statusCategories?.length) result.status_category = filters.statusCategories.join(",");
  if (filters.componentId) result.component = filters.componentId;
  if (filters.assigneeId) result.assignee = filters.assigneeId;
  if (filters.reporterId) result.reporter = filters.reporterId;
  if (filters.resolution) result.resolution = filters.resolution;
  if (filters.versionId) result.version = filters.versionId;
  if (filters.milestoneId) result.milestone = filters.milestoneId;
  if (filters.labelId) result.label = filters.labelId;
  if (filters.createdFrom) result.created_from = filters.createdFrom;
  if (filters.createdTo) result.created_to = filters.createdTo;
  if (filters.updatedFrom) result.updated_from = filters.updatedFrom;
  if (filters.updatedTo) result.updated_to = filters.updatedTo;
  if (filters.priority) result.priority = filters.priority;
  if (filters.severity) result.severity = filters.severity;
  if (filters.type) result.type = filters.type;
  if (filters.visibility) result.visibility = filters.visibility;
  if (filters.customFieldId) result.custom_field = filters.customFieldId;
  if (filters.customFieldValue) result.custom_value = filters.customFieldValue;
  if (filters.unresolved) result.unresolved = "1";
  if (filters.overdue) result.overdue = "1";
  if (filters.critical) result.critical = "1";
  return result;
}

export function decodeIssueSearchParams(
  params: Record<string, string | string[] | undefined>,
  valid: { stateIds: Set<string>; componentIds: Set<string>; memberIds?: Set<string>; versionIds?: Set<string>; milestoneIds?: Set<string>; labelIds?: Set<string>; customFieldIds?: Set<string> },
): IssueFilters {
  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = params[name];
      if (typeof value === "string" && value !== "") return value;
    }
    return undefined;
  };
  const statusId = pick("status", "statusId");
  const statusCategories = pick("status_category", "statusCategories")
    ?.split(",")
    .filter((value): value is WorkflowCategory => WORKFLOW_CATEGORIES.includes(value as WorkflowCategory));
  const componentId = pick("component", "componentId");
  const assigneeId = pick("assignee", "assigneeId");
  const reporterId = pick("reporter", "reporterId");
  const versionId = pick("version", "versionId");
  const milestoneId = pick("milestone", "milestoneId");
  const labelId = pick("label", "labelId");
  const priority = PRIORITIES.find((value) => value === pick("priority"));
  const severity = SEVERITIES.find((value) => value === pick("severity"));
  const type = ISSUE_TYPES.find((value) => value === pick("type"));
  const visibility = (["PROJECT", "RESTRICTED"] as const).find((value) => value === pick("visibility"));
  const resolution = RESOLUTIONS.find((value) => value === pick("resolution"));
  const date = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
  };
  const createdFrom = date(pick("created_from", "createdFrom"));
  const createdTo = date(pick("created_to", "createdTo"));
  const updatedFrom = date(pick("updated_from", "updatedFrom"));
  const updatedTo = date(pick("updated_to", "updatedTo"));
  const customFieldId = pick("custom_field", "customFieldId");
  const customFieldValue = pick("custom_value", "customFieldValue");
  const unresolved = pick("unresolved") === "1";
  const overdue = pick("overdue") === "1";
  const critical = pick("critical") === "1";
  return {
    statusId: statusId && valid.stateIds.has(statusId) ? statusId : undefined,
    statusCategories: statusCategories?.length ? [...new Set(statusCategories)] : undefined,
    priority,
    severity,
    type,
    visibility,
    componentId: componentId && valid.componentIds.has(componentId) ? componentId : undefined,
    assigneeId: assigneeId && (!valid.memberIds || valid.memberIds.has(assigneeId)) ? assigneeId : undefined,
    reporterId: reporterId && (!valid.memberIds || valid.memberIds.has(reporterId)) ? reporterId : undefined,
    resolution,
    versionId: versionId && (!valid.versionIds || valid.versionIds.has(versionId)) ? versionId : undefined,
    milestoneId: milestoneId && (!valid.milestoneIds || valid.milestoneIds.has(milestoneId)) ? milestoneId : undefined,
    labelId: labelId && (!valid.labelIds || valid.labelIds.has(labelId)) ? labelId : undefined,
    createdFrom: createdFrom && createdTo && createdFrom > createdTo ? undefined : createdFrom,
    createdTo: createdFrom && createdTo && createdFrom > createdTo ? undefined : createdTo,
    updatedFrom: updatedFrom && updatedTo && updatedFrom > updatedTo ? undefined : updatedFrom,
    updatedTo: updatedFrom && updatedTo && updatedFrom > updatedTo ? undefined : updatedTo,
    customFieldId: customFieldId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customFieldId) && (!valid.customFieldIds || valid.customFieldIds.has(customFieldId)) ? customFieldId : undefined,
    customFieldValue: customFieldValue && customFieldValue.length <= CUSTOM_FIELD_FILTER_MAX ? customFieldValue : undefined,
    unresolved: unresolved || undefined,
    overdue: overdue || undefined,
    critical: critical || undefined,
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
