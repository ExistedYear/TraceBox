export type ReleaseIssueForContext = {
  id: string;
  keyLabel: string;
  title: string;
  type: string;
  priority: string;
  severity: string;
  statusCategory: string;
  componentName?: string | null;
};

export type ReleaseContextInput = {
  milestoneName?: string | null;
  versionName?: string | null;
  readinessScore: number;
  blockerCount: number;
  criticalCount: number;
  regressionCount: number;
  securityCount: number;
  totalCount: number;
  resolvedCount: number;
  overdue?: boolean | null;
  topIssues: ReleaseIssueForContext[];
};

export function buildReleaseContext(input: ReleaseContextInput) {
  return {
    release: {
      milestone: input.milestoneName ?? null,
      version: input.versionName ?? null,
      readiness_percentage: Math.max(0, Math.min(100, input.readinessScore)),
      blocker_count: input.blockerCount,
      critical_count: input.criticalCount,
      regression_count: input.regressionCount,
      security_count: input.securityCount,
      total_issues: input.totalCount,
      resolved_issues: input.resolvedCount,
      overdue: Boolean(input.overdue),
    },
    top_risks: input.topIssues.slice(0, 8).map((issue) => ({
      issue_key: issue.keyLabel,
      title: issue.title.slice(0, 120),
      type: issue.type,
      priority: issue.priority,
      severity: issue.severity,
      component: issue.componentName ?? null,
      status_category: issue.statusCategory,
    })),
  };
}

export type ReleaseContext = ReturnType<typeof buildReleaseContext>;
