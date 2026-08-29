import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot, ListFilter, Plus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Surface } from "@/components/tracebox/primitives";
import { IssuesWithNaturalSearch } from "@/components/intelligence/issues-with-natural-search";
import { createClient } from "@/lib/supabase/server";
import { decodeIssueSearchParams } from "@/lib/issues";
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
  const [{ data: states }, { data: components }, { data: memberRows }, { data: adminRows }, { data: role }] = await Promise.all([
    supabase.from("workflow_states").select("id, name").eq("project_id", projectId).order("position"),
    supabase.from("components").select("id, name").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase.from("organization_members").select("user_id").eq("organization_id", context.activeOrganization.id).in("role", ["OWNER", "ADMIN"]),
    supabase.rpc("project_role", { p_project_id: projectId }),
  ]);

  const candidates = [...(memberRows ?? []), ...(adminRows ?? [])];
  const names = await displayNameMap(candidates.map((row) => row.user_id));
  const filters = decodeIssueSearchParams(rawParams, {
    stateIds: new Set((states ?? []).map((state) => state.id)),
    componentIds: new Set((components ?? []).map((component) => component.id)),
    memberIds: new Set(candidates.map((row) => row.user_id)),
  });

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
          <Button asChild size="sm" className="gap-2"><Link href="/dashboard/issues/new"><Plus className="h-3.5 w-3.5" /> New issue</Link></Button>
        </div>
      </div>

      {(states ?? []).length === 0 ? (
        <Surface className="p-8 text-center text-sm text-muted-foreground">This project has no workflow states yet.</Surface>
      ) : (
        <IssuesWithNaturalSearch
          projectId={projectId}
          projectKey={context.activeProject.key}
          canEdit={role === "DEVELOPER" || role === "MAINTAINER"}
          currentUserId={context.userId}
          states={(states ?? []).map((state) => ({ value: state.id, label: state.name }))}
          components={(components ?? []).map((component) => ({ value: component.id, label: component.name }))}
          members={[...new Map(candidates.map((row) => [row.user_id, { value: row.user_id, label: personLabel(names.get(row.user_id), row.user_id) }])).values()]}
          initialFilters={filters as unknown as Record<string, string>}
        />
      )}
    </main>
  );
}
