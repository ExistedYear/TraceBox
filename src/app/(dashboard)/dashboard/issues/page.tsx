import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot, ListFilter, Plus, Users } from "lucide-react";

import { IssueTable } from "@/components/issues/issue-table";
import { Button } from "@/components/ui/button";
import { EmptyState, Surface } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/server";
import { decodeIssueSearchParams, WORKFLOW_CATEGORIES } from "@/lib/issues";
import { MILESTONE_STATUSES } from "@/lib/validation/planning";
import { isSavedViewId } from "@/lib/validation/saved-views";
import { personLabel } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Issues" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function IssuesPage({ searchParams }: { searchParams: SearchParams }) {
  const [context, rawParams] = await Promise.all([getWorkspaceContext(), searchParams]);
  if (!context.activeProject) {
    return (
      <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <EmptyState icon={CircleDot} title="No project selected" description="Pick a project from the sidebar switcher to see its issues." />
      </main>
    );
  }
  const projectId = context.activeProject.id;

  const supabase = await createClient();
  const results = await Promise.all([
    supabase.from("workflow_states").select("id, name, category").eq("project_id", projectId).order("position"),
    supabase.from("components").select("id, name").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase.from("organization_members").select("user_id").eq("organization_id", context.activeOrganization.id).in("role", ["OWNER", "ADMIN"]),
    supabase.rpc("project_role", { p_project_id: projectId }),
    supabase.from("versions").select("id, name").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("milestones").select("id, name, due_at, status").eq("project_id", projectId).order("name"),
    supabase.from("labels").select("id, name").eq("project_id", projectId).order("name"),
    supabase.from("custom_fields").select("id, name, field_type, config").eq("project_id", projectId).order("name"),
  ]);
  const [{ data: states, error: statesError }, { data: components, error: componentsError }, { data: memberRows, error: memberError }, { data: adminRows, error: adminsError }, { data: role, error: roleError }, { data: versions, error: versionsError }, { data: milestones, error: milestonesError }, { data: labels, error: labelsError }, { data: customFieldRows, error: customFieldsError }] = results;
  const queryError = statesError ?? componentsError ?? memberError ?? adminsError ?? roleError ?? versionsError ?? milestonesError ?? labelsError ?? customFieldsError;
  if (queryError) {
    console.error("Issue queue metadata query failed", { code: queryError.code, message: queryError.message });
    return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><Surface className="space-y-3 border-destructive/30 p-8 text-center"><h1 className="text-lg font-semibold">Issues unavailable</h1><p className="text-sm text-muted-foreground">The issue queue could not load its project metadata. No empty result was inferred.</p><Link href="/dashboard/issues" className="text-sm font-medium text-primary underline underline-offset-4">Retry</Link></Surface></main>;
  }

  const candidates = [...(memberRows ?? []), ...(adminRows ?? [])];
  const names = await displayNameMap(candidates.map((row) => row.user_id));
  const requestedViewId = typeof rawParams.view === "string" && isSavedViewId(rawParams.view) ? rawParams.view : undefined;
  let filterParams = rawParams;
  if (requestedViewId) {
    const { data: requestedView, error: viewError } = await supabase.from("saved_views").select("project_id, filters").eq("id", requestedViewId).maybeSingle();
    if (viewError) {
      console.error("Saved view link load failed", { code: viewError.code, message: viewError.message });
    } else if (requestedView?.project_id === projectId && requestedView.filters && typeof requestedView.filters === "object") {
      filterParams = Object.fromEntries(Object.entries(requestedView.filters as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string>;
    }
  }
  const filters = decodeIssueSearchParams(filterParams, {
    stateIds: new Set((states ?? []).map((state) => state.id)),
    componentIds: new Set((components ?? []).map((component) => component.id)),
    memberIds: new Set(candidates.map((row) => row.user_id)),
    versionIds: new Set((versions ?? []).map((version) => version.id)),
    milestoneIds: new Set((milestones ?? []).map((milestone) => milestone.id)),
    labelIds: new Set((labels ?? []).map((label) => label.id)),
    customFieldIds: new Set((customFieldRows ?? []).map((field) => field.id)),
  });
  const unresolvedStateIds = (states ?? []).filter((state) => !["RESOLVED", "CLOSED"].includes(state.category)).map((state) => state.id);
  const overdueMilestoneIds = (milestones ?? []).filter((milestone) => milestone.due_at && MILESTONE_STATUSES.includes(milestone.status as (typeof MILESTONE_STATUSES)[number]) && ["PLANNED", "ACTIVE"].includes(milestone.status) && new Date(milestone.due_at).getTime() < new Date().getTime()).map((milestone) => milestone.id);
  const stateCategoryIds = Object.fromEntries(WORKFLOW_CATEGORIES.map((category) => [category, (states ?? []).filter((state) => state.category === category).map((state) => state.id)]));

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <Link href="/dashboard" className="transition-colors hover:text-foreground">Overview</Link>
            <span aria-hidden="true">/</span>
            <span className="text-primary">{context.activeProject.key}</span>
          </nav>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary"><ListFilter className="h-4 w-4" /></span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Issues</h1>
              <p className="mt-1 text-sm text-muted-foreground">Search, triage, and update {context.activeProject.name} issues.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs"><Link href="/dashboard/settings/contributors"><Users className="h-3.5 w-3.5" /> Contributors</Link></Button>
          {role === "REPORTER" || role === "DEVELOPER" || role === "MAINTAINER" ? <Button asChild size="sm" className="gap-2"><Link href="/dashboard/issues/new"><Plus className="h-3.5 w-3.5" /> New issue</Link></Button> : null}
        </div>
      </div>

      {(states ?? []).length === 0 ? (
        <Surface className="p-8 text-center text-sm text-muted-foreground">This project has no workflow states yet.</Surface>
      ) : (
        <IssueTable
          key={projectId}
          projectKey={context.activeProject.key}
          projectId={projectId}
          canEdit={role === "DEVELOPER" || role === "MAINTAINER"}
          canManageProject={role === "MAINTAINER"}
          currentUserId={context.userId}
          states={(states ?? []).map((state) => ({ value: state.id, label: state.name }))}
          components={(components ?? []).map((component) => ({ value: component.id, label: component.name }))}
          members={[...new Map(candidates.map((row) => [row.user_id, { value: row.user_id, label: personLabel(names.get(row.user_id), row.user_id) }])).values()]}
          versions={(versions ?? []).map((version) => ({ value: version.id, label: version.name }))}
          milestones={(milestones ?? []).map((milestone) => ({ value: milestone.id, label: milestone.name }))}
          labels={(labels ?? []).map((label) => ({ value: label.id, label: label.name }))}
          customFields={(customFieldRows ?? []).map((field) => ({ id: field.id, name: field.name, field_type: field.field_type, config: (field.config ?? {}) as Record<string, unknown> }))}
          unresolvedStateIds={unresolvedStateIds}
          overdueMilestoneIds={overdueMilestoneIds}
          stateCategoryIds={stateCategoryIds}
          initialFilters={filters}
          initialSearchQuery={typeof filterParams.q === "string" ? filterParams.q : ""}
        />
      )}
    </main>
  );
}
