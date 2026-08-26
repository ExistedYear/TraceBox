import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot, Plus } from "lucide-react";

import { IssueTable } from "@/components/issues/issue-table";
import { Button } from "@/components/ui/button";
import { EmptyState, Surface } from "@/components/tracebox/primitives";
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
  const [{ data: states }, { data: components }, { data: memberRows }, { data: role }] = await Promise.all([
    supabase.from("workflow_states").select("id, name").eq("project_id", projectId).order("position"),
    supabase.from("components").select("id, name").eq("project_id", projectId).eq("is_archived", false).order("name"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase.rpc("project_role", { p_project_id: projectId }),
  ]);

  const names = await displayNameMap((memberRows ?? []).map((row) => row.user_id));
  const filters = decodeIssueSearchParams(rawParams, {
    stateIds: new Set((states ?? []).map((state) => state.id)),
    componentIds: new Set((components ?? []).map((component) => component.id)),
  });

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">{context.activeProject.key} · Issue queue</p>
          <h1 className="text-3xl font-semibold tracking-tight">Issues</h1>
        </div>
        <Button asChild size="sm" className="gap-2">
          <Link href="/dashboard/issues/new"><Plus className="h-3.5 w-3.5" /> New issue</Link>
        </Button>
      </div>

      {(states ?? []).length === 0 ? (
        <Surface className="p-8 text-center text-sm text-muted-foreground">This project has no workflow states yet.</Surface>
      ) : (
        <IssueTable
          projectKey={context.activeProject.key}
          projectId={projectId}
          canEdit={role === "DEVELOPER" || role === "MAINTAINER"}
          currentUserId={context.userId}
          states={(states ?? []).map((state) => ({ value: state.id, label: state.name }))}
          components={(components ?? []).map((component) => ({ value: component.id, label: component.name }))}
          members={(memberRows ?? []).map((row) => ({ value: row.user_id, label: personLabel(names.get(row.user_id), row.user_id) }))}
          initialFilters={filters}
        />
      )}
    </main>
  );
}
