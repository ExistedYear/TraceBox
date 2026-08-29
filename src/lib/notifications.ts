import { formatIssueKey } from "@/lib/issues";

export const NOTIFICATION_TYPES = [
  "ASSIGNED",
  "MENTION",
  "COMMENT",
  "STATUS_CHANGED",
  "ISSUE_LINKED",
  "LABEL_CHANGED",
  "PLANNING_CHANGED",
  "MILESTONE_CHANGED",
  "WATCHED_ISSUE_UPDATED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationData = {
  excerpt?: string;
  issue_number?: number;
  project_key?: string;
  title?: string;
  relationship?: string;
  restricted?: boolean;
  [key: string]: unknown;
};

export type NotificationItem = {
  id: string;
  issue_id: string | null;
  type: NotificationType | string;
  data: NotificationData;
  actor_id: string | null;
  actor_name: string | null;
  issue_number: number | null;
  project_key: string | null;
  issue_title: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationCursor = {
  createdAt: string;
  id: string;
};

export type NotificationPage = {
  items: NotificationItem[];
  nextCursor: NotificationCursor | null;
  hasMore: boolean;
};

export type NotificationPreferences = {
  user_id: string;
  mentions: boolean;
  assignments: boolean;
  comments: boolean;
  status_changes: boolean;
  watch_updates: boolean;
  issue_links: boolean;
  labels: boolean;
  planning: boolean;
  milestones: boolean;
  updated_at: string | null;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferences, "user_id" | "updated_at"> = {
  mentions: true,
  assignments: true,
  comments: true,
  status_changes: true,
  watch_updates: true,
  issue_links: true,
  labels: true,
  planning: true,
  milestones: true,
};

export function notificationLabel(type: string) {
  switch (type) {
    case "ASSIGNED": return "assigned you to an issue";
    case "MENTION": return "mentioned you in a comment";
    case "COMMENT": return "commented on an issue";
    case "STATUS_CHANGED": return "changed an issue status";
    case "ISSUE_LINKED": return "linked an issue";
    case "LABEL_CHANGED": return "changed issue labels";
    case "PLANNING_CHANGED": return "changed issue planning";
    case "MILESTONE_CHANGED": return "changed a milestone";
    case "WATCHED_ISSUE_UPDATED": return "updated an issue you watch";
    default: return "sent you a notification";
  }
}

/** Build links only from server-returned project key/issue number values. */
export function notificationHref(item: Pick<NotificationItem, "issue_id" | "issue_number" | "project_key" | "data">) {
  if (!item.issue_id || !item.project_key || !item.issue_number || item.issue_number < 1) return null;
  if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(item.project_key)) return null;
  return `/dashboard/issues/${formatIssueKey(item.project_key, item.issue_number)}`;
}

export function notificationPageFromRows(rows: Array<Record<string, unknown>>): NotificationPage {
  const items = rows.map((row) => ({
    id: String(row.id),
    issue_id: row.issue_id ? String(row.issue_id) : null,
    type: String(row.type),
    data: (row.data && typeof row.data === "object" ? row.data : {}) as NotificationData,
    actor_id: row.actor_id ? String(row.actor_id) : null,
    actor_name: typeof row.actor_name === "string" ? row.actor_name : null,
    issue_number: typeof row.issue_number === "number" ? row.issue_number : null,
    project_key: typeof row.project_key === "string" ? row.project_key : null,
    issue_title: typeof row.issue_title === "string" ? row.issue_title : null,
    read_at: typeof row.read_at === "string" ? row.read_at : null,
    created_at: String(row.created_at),
  } satisfies NotificationItem));
  const last = rows.at(-1);
  const hasMore = last?.has_more === true;
  return {
    items,
    hasMore,
    nextCursor: hasMore && last && typeof last.next_cursor_created_at === "string" && typeof last.next_cursor_id === "string"
      ? { createdAt: last.next_cursor_created_at, id: last.next_cursor_id }
      : null,
  };
}
