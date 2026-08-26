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

function labelOf(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
