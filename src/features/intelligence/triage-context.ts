import { calculateReportQuality } from "./report-quality";

export type TriageIssueInput = {
  id: string;
  issue_number: number;
  project_id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  severity: string;
  status_id: string;
  component_id: string | null;
  affected_version_id: string | null;
  target_milestone_id: string | null;
  environment: string | null;
  steps_to_reproduce: string | null;
  expected_behavior: string | null;
  actual_behavior: string | null;
  visibility?: string | null;
  updated_at?: string | null;
};

export type ComponentOption = { id: string; name: string; description?: string | null; default_assignee_id?: string | null };
export type AssigneeOption = { user_id: string; display_name: string | null; role?: string | null; is_component_owner?: boolean };
export type DuplicateCandidateInput = { id: string; issue_number: number; project_key?: string; title: string; description: string | null; component_id: string | null; affected_version_id: string | null; status?: string | null; similarity?: number };

export function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export function buildTriageContext(input: {
  issue: TriageIssueInput;
  components: ComponentOption[];
  assignees: AssigneeOption[];
  duplicateCandidates: DuplicateCandidateInput[];
  attachments?: Array<{ filename?: string | null; mime_type?: string | null }>;
  projectKey?: string;
}) {
  const reportQuality = calculateReportQuality(
    {
      description: input.issue.description,
      steps_to_reproduce: input.issue.steps_to_reproduce,
      expected_behavior: input.issue.expected_behavior,
      actual_behavior: input.issue.actual_behavior,
      environment: input.issue.environment,
      affected_version_id: input.issue.affected_version_id,
      title: input.issue.title,
    },
    input.attachments as never,
  );

  const issuePayload = {
    id: input.issue.id,
    issue_number: input.issue.issue_number,
    key: input.projectKey ? `${input.projectKey}-${input.issue.issue_number}` : undefined,
    title: truncate(input.issue.title, 200),
    description: truncate(input.issue.description, 2000),
    type: input.issue.type,
    priority: input.issue.priority,
    severity: input.issue.severity,
    status_id: input.issue.status_id,
    component_id: input.issue.component_id,
    affected_version_id: input.issue.affected_version_id,
    target_milestone_id: input.issue.target_milestone_id,
    environment: truncate(input.issue.environment, 500),
    steps_to_reproduce: truncate(input.issue.steps_to_reproduce, 1000),
    expected_behavior: truncate(input.issue.expected_behavior, 1000),
    actual_behavior: truncate(input.issue.actual_behavior, 1000),
    report_quality: reportQuality,
    updated_at: input.issue.updated_at ?? null,
  };

  const componentsPayload = input.components.map((component) => ({
    id: component.id,
    name: component.name,
    description: truncate(component.description ?? null, 200),
    default_assignee_id: component.default_assignee_id ?? null,
  }));

  const assigneesPayload = input.assignees.map((assignee) => ({
    user_id: assignee.user_id,
    display_name: assignee.display_name,
    role: assignee.role ?? null,
    is_component_owner: Boolean(assignee.is_component_owner),
  }));

  const candidatesPayload = input.duplicateCandidates.slice(0, 3).map((candidate) => ({
    id: candidate.id,
    issue_number: candidate.issue_number,
    key: candidate.project_key ? `${candidate.project_key}-${candidate.issue_number}` : undefined,
    title: truncate(candidate.title, 120),
    description: truncate(candidate.description, 800),
    component_id: candidate.component_id,
    affected_version_id: candidate.affected_version_id,
    status: candidate.status ?? null,
    similarity: candidate.similarity ?? null,
  }));

  return {
    issue: issuePayload,
    reportQuality,
    components: componentsPayload,
    possibleAssignees: assigneesPayload,
    candidateDuplicates: candidatesPayload,
  };
}

export type TriageContext = ReturnType<typeof buildTriageContext>;
