"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { NaturalSearch } from "@/components/intelligence/natural-search";
import { IssueTable, type FilterOption } from "@/components/issues/issue-table";
import type { SearchParseResult } from "@/lib/ai/schemas/search";
import type { IssueFilters, WorkflowCategory } from "@/lib/issues";

type Props = { projectId: string; projectKey: string; canEdit: boolean; canManageProject: boolean; currentUserId: string; states: FilterOption[]; components: FilterOption[]; members: FilterOption[]; versions: FilterOption[]; milestones: FilterOption[]; labels: FilterOption[]; customFields: Array<{ id: string; name: string; field_type: string; config: Record<string, unknown> }>; unresolvedStateIds: string[]; overdueMilestoneIds: string[]; stateCategoryIds: Partial<Record<WorkflowCategory, string[]>>; initialFilters: IssueFilters; initialSearchQuery?: string; aiConfigured?: boolean };

export function IssuesWithNaturalSearch({ projectId, projectKey, canEdit, canManageProject, currentUserId, states, components, members, versions, milestones, labels, customFields, unresolvedStateIds, overdueMilestoneIds, stateCategoryIds, initialFilters, initialSearchQuery = "", aiConfigured = true }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function apply(filters: SearchParseResult) {
    const params = new URLSearchParams(searchParams.toString());
    const values: Record<string, string | null> = {
      status: filters.statuses[0] ?? null,
      resolution: filters.resolutions[0] ?? null,
      priority: filters.priorities[0] ?? null,
      severity: filters.severities[0] ?? null,
      type: filters.types[0] ?? null,
      assignee: filters.assignee === "ME" ? currentUserId : filters.assignee ?? null,
      reporter: filters.reporter === "ME" ? currentUserId : filters.reporter ?? null,
      component: filters.component_id ?? null,
      version: filters.affected_version_id ?? null,
      milestone: filters.target_milestone_id ?? null,
      label: filters.labels[0] ?? null,
      q: filters.text ?? null,
      status_category: filters.status_categories.join(",") || null,
      visibility: filters.visibility ?? null,
      created_from: filters.created_from,
      created_to: filters.created_to,
      updated_from: filters.updated_from,
      updated_to: filters.updated_to,
      custom_field: filters.custom_field_id,
      custom_value: filters.custom_value,
      unresolved: filters.unresolved ? "1" : null,
      overdue: filters.overdue ? "1" : null,
      critical: filters.critical ? "1" : null,
    };
    for (const [key, value] of Object.entries(values)) { if (value) params.set(key, value); else params.delete(key); }
    params.delete("page");
    router.push(`?${params.toString()}`);
  }

  return <div className="space-y-3"><NaturalSearch projectId={projectId} onApply={apply} aiConfigured={aiConfigured} options={{ states, components, members, versions, milestones, labels, customFields: customFields.map((field) => ({ value: field.id, label: field.name })) }} /><IssueTable key={projectId} projectKey={projectKey} projectId={projectId} canEdit={canEdit} canManageProject={canManageProject} currentUserId={currentUserId} states={states} components={components} members={members} versions={versions} milestones={milestones} labels={labels} customFields={customFields} unresolvedStateIds={unresolvedStateIds} overdueMilestoneIds={overdueMilestoneIds} stateCategoryIds={stateCategoryIds} initialFilters={initialFilters} initialSearchQuery={initialSearchQuery} /></div>;
}
