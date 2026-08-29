export type ReportTrendPoint = {
  day: string;
  created: number;
  resolved: number;
  backlog: number;
};

export type ReportIssue = {
  id: string;
  issue_number: number;
  title: string;
  type?: string;
  priority?: string;
  severity?: string;
  status?: string;
  status_name?: string;
  status_category?: string;
  component_name?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  milestone_id?: string | null;
  milestone_name?: string | null;
  created_at?: string;
  resolved_at?: string | null;
  closed_at?: string | null;
  resolution_days?: number | null;
};

export type ReportMetrics = {
  window_days: number;
  window_start: string;
  window_end: string;
  visible_count: number;
  window_issue_count: number;
  no_data: boolean;
  created: number;
  resolved: number;
  backlog: number;
  avg_resolution_days: number | null;
  resolution_duration: {
    count: number;
    avg_days: number | null;
    median_days: number | null;
    p90_days: number | null;
  };
  category_counts: Record<string, number>;
  priority_counts: Record<string, number>;
  component_counts: Array<{ id: string; name: string; count: number }>;
  by_assignee: Array<{ id: string; name: string; count: number }>;
  by_milestone: Array<{ id: string; name: string; count: number }>;
  historical_trend: ReportTrendPoint[];
  trend: ReportTrendPoint[];
  drilldown: ReportIssue[];
  drilldowns: {
    created: ReportIssue[];
    resolved: ReportIssue[];
    backlog: ReportIssue[];
  };
};

const numberOr = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const arrayOr = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

export function normalizeReportMetrics(value: unknown): ReportMetrics {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const duration = (raw.resolution_duration && typeof raw.resolution_duration === "object" ? raw.resolution_duration : {}) as Record<string, unknown>;
  const trend = arrayOr<ReportTrendPoint>(raw.historical_trend ?? raw.trend).map((item) => ({
    day: String(item?.day ?? ""), created: numberOr(item?.created), resolved: numberOr(item?.resolved), backlog: numberOr(item?.backlog),
  }));
  return {
    window_days: numberOr(raw.window_days, 30), window_start: String(raw.window_start ?? ""), window_end: String(raw.window_end ?? ""),
    visible_count: numberOr(raw.visible_count), window_issue_count: numberOr(raw.window_issue_count), no_data: raw.no_data === true,
    created: numberOr(raw.created), resolved: numberOr(raw.resolved), backlog: numberOr(raw.backlog),
    avg_resolution_days: typeof raw.avg_resolution_days === "number" ? raw.avg_resolution_days : null,
    resolution_duration: { count: numberOr(duration.count), avg_days: typeof duration.avg_days === "number" ? duration.avg_days : null, median_days: typeof duration.median_days === "number" ? duration.median_days : null, p90_days: typeof duration.p90_days === "number" ? duration.p90_days : null },
    category_counts: (raw.category_counts && typeof raw.category_counts === "object" ? raw.category_counts : {}) as Record<string, number>,
    priority_counts: (raw.priority_counts && typeof raw.priority_counts === "object" ? raw.priority_counts : {}) as Record<string, number>,
    component_counts: arrayOr<{ id: string; name: string; count: number }>(raw.component_counts),
    by_assignee: arrayOr<{ id: string; name: string; count: number }>(raw.by_assignee),
    by_milestone: arrayOr<{ id: string; name: string; count: number }>(raw.by_milestone),
    historical_trend: trend, trend,
    drilldown: arrayOr<ReportIssue>(raw.drilldown),
    drilldowns: { created: arrayOr<ReportIssue>((raw.drilldowns as Record<string, unknown> | undefined)?.created), resolved: arrayOr<ReportIssue>((raw.drilldowns as Record<string, unknown> | undefined)?.resolved), backlog: arrayOr<ReportIssue>((raw.drilldowns as Record<string, unknown> | undefined)?.backlog) },
  };
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Build a deterministic, spreadsheet-safe export from server-returned data. */
export function reportMetricsCsv(projectKey: string, metrics: ReportMetrics) {
  const rows: unknown[][] = [["metric", "issue_key", "issue_number", "title", "type", "priority", "severity", "status", "status_category", "component", "assignee_id", "assignee", "milestone_id", "milestone", "created_at", "resolved_at", "closed_at", "resolution_days"]];
  const groups: Array<[string, ReportIssue[]]> = [["created", metrics.drilldowns.created], ["resolved", metrics.drilldowns.resolved], ["backlog", metrics.drilldowns.backlog.length ? metrics.drilldowns.backlog : metrics.drilldown]];
  const seen = new Set<string>();
  for (const [metric, issues] of groups) for (const issue of issues) {
    const key = `${metric}:${issue.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([metric, `${projectKey}-${issue.issue_number}`, issue.issue_number, issue.title, issue.type ?? "", issue.priority ?? "", issue.severity ?? "", issue.status_name ?? issue.status ?? "", issue.status_category ?? "", issue.component_name ?? "", issue.assignee_id ?? "", issue.assignee_name ?? "", issue.milestone_id ?? "", issue.milestone_name ?? "", issue.created_at ?? "", issue.resolved_at ?? "", issue.closed_at ?? "", issue.resolution_days ?? ""]);
  }
  rows.push([], ["trend_day", "created", "resolved", "backlog"]);
  for (const point of metrics.historical_trend) rows.push([point.day, point.created, point.resolved, point.backlog]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
