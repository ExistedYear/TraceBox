import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Surface } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/server";
import { formatIssueKey } from "@/lib/issues";
import { displayNameMap, personLabel } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Issues" };

export default async function IssuesPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) {
    return (
      <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <EmptyState icon={CircleDot} title="No project selected" description="Pick a project from the sidebar switcher to see its issues." />
      </main>
    );
  }
  const projectId = context.activeProject.id;

  const supabase = await createClient();
  const { data: issues } = await supabase
    .from("issues")
    .select("id, issue_number, title, priority, severity, status:workflow_states (name, category), component:components (name), assignee_id, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(50);

  const names = await displayNameMap((issues ?? []).map((issue) => issue.assignee_id));

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex items-end justify-between gap-3">
        <div>
          <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">{context.activeProject?.key ?? ""} · Issue queue</p>
          <h1 className="text-3xl font-semibold tracking-tight">Issues</h1>
          <p className="mt-2 text-muted-foreground">Latest 50 issues for {context.activeProject.name}, newest activity first.</p>
        </div>
        <Button asChild size="sm" className="gap-2">
          <Link href="/dashboard/issues/new"><Plus className="h-3.5 w-3.5" /> New issue</Link>
        </Button>
      </div>

      <Surface>
        {(issues ?? []).length === 0 ? (
          <EmptyState
            icon={CircleDot}
            title="No issues yet"
            description={`File the first ${context.activeProject?.key ?? ""}-1 to start tracking work.`}
            action={<Button asChild size="sm"><Link href="/dashboard/issues/new">New issue</Link></Button>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/80 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">ID</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Priority</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Severity</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Component</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Assignee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {(issues ?? []).map((issue) => (
                <tr key={issue.id} className="group hover:bg-accent/40">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">{formatIssueKey(context.activeProject?.key ?? "", issue.issue_number)}</td>
                  <td className="max-w-md truncate px-4 py-2.5">
                    <Link href={`/dashboard/issues/${formatIssueKey(context.activeProject?.key ?? "", issue.issue_number)}`} className="font-medium hover:text-primary">{issue.title}</Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">{issue.status?.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{issue.priority}</td>
                  <td className="hidden px-4 py-2.5 text-xs sm:table-cell">{issue.severity}</td>
                  <td className="hidden px-4 py-2.5 text-xs md:table-cell">{issue.component?.name ?? "—"}</td>
                  <td className="hidden px-4 py-2.5 text-xs md:table-cell">{personLabel(names.get(issue.assignee_id ?? ""), issue.assignee_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </main>
  );
}
