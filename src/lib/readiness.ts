import { formatIssueKey } from "@/lib/issues";

export type ReadinessIssue = {
  id: string;
  issueNumber: number;
  keyLabel: string;
  title: string;
  type: string;
  priority: string;
  severity: string;
  statusCategory: string;
  statusName: string;
  assigneeId: string | null;
  assigneeLabel: string;
  componentName: string | null;
  targetMilestoneId: string | null;
  affectedVersionId: string | null;
  dueAt: string | null;
};

export type ReadinessAnalysis = {
  total: number;
  resolvedCount: number;
  openCount: number;
  blockerCount: number;
  criticalCount: number;
  regressionCount: number;
  unassignedCount: number;
  unresolvedSecurityCount: number;
  overdueMilestoneCount: number;
  score: number;
  status: "READY" | "ATTENTION" | "BLOCKED" | "NO_DATA";
  issues: ReadinessIssue[];
};

const integer = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);

/** Normalize untrusted JSON returned by the readiness RPC before rendering it. */
export function normalizeReadinessAnalysis(value: unknown, projectKey: string): ReadinessAnalysis {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rows = Array.isArray(raw.issues) ? raw.issues : [];
  const issues = rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const issueNumber = integer(row.issueNumber);
    if (!id || issueNumber < 1) return [];
    return [{
      id, issueNumber, keyLabel: formatIssueKey(projectKey, issueNumber),
      title: typeof row.title === "string" ? row.title : "Restricted issue",
      type: typeof row.type === "string" ? row.type : "BUG",
      priority: typeof row.priority === "string" ? row.priority : "P2",
      severity: typeof row.severity === "string" ? row.severity : "MAJOR",
      statusCategory: typeof row.statusCategory === "string" ? row.statusCategory : "OPEN",
      statusName: typeof row.statusName === "string" ? row.statusName : "Open",
      assigneeId: typeof row.assigneeId === "string" ? row.assigneeId : null,
      assigneeLabel: typeof row.assigneeId === "string" ? "Assigned" : "Unassigned",
      componentName: typeof row.componentName === "string" ? row.componentName : null,
      targetMilestoneId: typeof row.targetMilestoneId === "string" ? row.targetMilestoneId : null,
      affectedVersionId: typeof row.affectedVersionId === "string" ? row.affectedVersionId : null,
      dueAt: typeof row.dueAt === "string" ? row.dueAt : null,
    } satisfies ReadinessIssue];
  });
  const status = raw.status === "READY" || raw.status === "ATTENTION" || raw.status === "BLOCKED" || raw.status === "NO_DATA" ? raw.status : "NO_DATA";
  return {
    total: integer(raw.total), resolvedCount: integer(raw.resolved_count), openCount: integer(raw.open_count),
    blockerCount: integer(raw.blocker_count), criticalCount: integer(raw.critical_count),
    regressionCount: integer(raw.regression_count), unassignedCount: integer(raw.unassigned_count),
    unresolvedSecurityCount: integer(raw.unresolved_security_count), overdueMilestoneCount: integer(raw.overdue_milestone_count),
    score: Math.min(100, integer(raw.score)), status, issues,
  };
}

export function readinessRiskGroups(analysis: ReadinessAnalysis, now = Date.now()) {
  const open = analysis.issues.filter((issue) => issue.statusCategory !== "RESOLVED" && issue.statusCategory !== "CLOSED");
  const blockers = open.filter((issue) => issue.priority === "P0" || issue.severity === "BLOCKER");
  const criticals = open.filter((issue) => (issue.priority === "P1" || issue.severity === "CRITICAL") && !blockers.includes(issue));
  const regressions = open.filter((issue) => issue.type === "REGRESSION");
  const unassigned = open.filter((issue) => !issue.assigneeId);
  const security = open.filter((issue) => issue.type === "SECURITY");
  const overdue = open.filter((issue) => issue.dueAt && new Date(issue.dueAt).getTime() < now);
  return { blockers, criticals, regressions, unassigned, security, overdue, riskCount: new Set([...blockers, ...criticals, ...regressions, ...unassigned, ...security, ...overdue].map((issue) => issue.id)).size };
}

export function readinessCsv(analysis: ReadinessAnalysis): string {
  const rows = [["Issue", "Title", "Type", "Priority", "Severity", "Status", "Assignee", "Risk"]];
  const risks = readinessRiskGroups(analysis);
  const riskIds = new Set([...risks.blockers, ...risks.criticals, ...risks.regressions, ...risks.unassigned, ...risks.security, ...risks.overdue].map((issue) => issue.id));
  for (const issue of analysis.issues) {
    rows.push([issue.keyLabel, issue.title, issue.type, issue.priority, issue.severity, issue.statusName, issue.assigneeLabel, riskIds.has(issue.id) ? "AT_RISK" : "OPEN"]);
  }
  return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
}
