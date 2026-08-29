"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { IssueTable } from "@/components/issues/issue-table";
import { NaturalSearch } from "@/components/intelligence/natural-search";
import type { SearchParseResult } from "@/lib/ai/schemas/search";

type Props = {
  projectId: string;
  projectKey: string;
  canEdit: boolean;
  currentUserId: string;
  states: Array<{ value: string; label: string }>;
  components: Array<{ value: string; label: string }>;
  members: Array<{ value: string; label: string }>;
  initialFilters: Record<string, string>;
};

export function IssuesWithNaturalSearch({ projectId, projectKey, canEdit, currentUserId, states, components, members, initialFilters }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleNaturalApply(filters: SearchParseResult) {
    const params = new URLSearchParams(searchParams.toString());
    const map: Record<string, string | null> = {
      status: filters.statuses[0] ?? null,
      component: filters.component_id ?? null,
      assignee: filters.assignee === "ME" ? currentUserId : filters.assignee ?? null,
      priority: filters.priorities[0] ?? null,
      severity: filters.severities[0] ?? null,
      type: filters.types[0] ?? null,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (filters.text) params.set("q", filters.text);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <NaturalSearch projectId={projectId} onApply={handleNaturalApply} />
      <IssueTable
        key={projectId}
        projectKey={projectKey}
        projectId={projectId}
        canEdit={canEdit}
        currentUserId={currentUserId}
        states={states}
        components={components}
        members={members}
        initialFilters={initialFilters as never}
      />
    </div>
  );
}
