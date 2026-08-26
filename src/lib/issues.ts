export const ISSUE_TYPES = ["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
export const SEVERITIES = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"] as const;
export const RESOLUTIONS = ["FIXED", "DUPLICATE", "WONT_FIX", "INVALID", "CANNOT_REPRODUCE", "WORKS_AS_EXPECTED"] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Severity = (typeof SEVERITIES)[number];

export function formatIssueKey(projectKey: string, issueNumber: number) {
  return `${projectKey.toUpperCase()}-${issueNumber}`;
}

export function parseIssueKey(param: string): { projectKey: string; issueNumber: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(param);
  if (!match) return null;
  return { projectKey: match[1].toUpperCase(), issueNumber: Number(match[2]) };
}

// Maps an immutable audit event to human timeline copy; never renders raw JSON.
export function eventSummary(event: {
  event_type: string;
  field_name?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  metadata?: unknown;
}): { heading: string; detail?: string } {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  switch (event.event_type) {
    case "ISSUE_CREATED":
      return { heading: "created this issue", detail: typeof meta.title === "string" ? meta.title : undefined };
    case "STATUS_CHANGED":
      return { heading: "changed status", detail: `${labelOf(event.old_value)} → ${labelOf(event.new_value)}` };
    case "ASSIGNEE_CHANGED":
      return { heading: "changed assignee", detail: `${labelOf(event.old_value)} → ${labelOf(event.new_value)}` };
    case "PRIORITY_CHANGED":
      return { heading: "changed priority", detail: `${labelOf(event.old_value)} → ${labelOf(event.new_value)}` };
    case "SEVERITY_CHANGED":
      return { heading: "changed severity", detail: `${labelOf(event.old_value)} → ${labelOf(event.new_value)}` };
    case "RESOLUTION_CHANGED":
      return { heading: "set resolution", detail: labelOf(event.new_value) };
    case "TITLE_CHANGED":
      return { heading: "renamed the issue", detail: `${labelOf(event.old_value)} → ${labelOf(event.new_value)}` };
    default:
      return { heading: event.event_type.toLowerCase().replaceAll("_", " ") };
  }
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
};

export const DEFAULT_FILTERS: IssueFilters = {};

export function encodeIssueFilters(filters: IssueFilters): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value))) as Record<string, string>;
}

export function decodeIssueSearchParams(
  params: Record<string, string | string[] | undefined>,
  valid: { stateIds: Set<string>; componentIds: Set<string> },
): IssueFilters {
  const pick = (name: string) => {
    const value = params[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const statusId = pick("status");
  const componentId = pick("component");
  return {
    statusId: statusId && valid.stateIds.has(statusId) ? statusId : undefined,
    priority: pick("priority"),
    severity: pick("severity"),
    type: pick("type"),
    componentId: componentId && valid.componentIds.has(componentId) ? componentId : undefined,
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
