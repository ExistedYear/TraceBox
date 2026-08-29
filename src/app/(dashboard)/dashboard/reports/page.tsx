import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { NewProjectButton } from "@/components/layout/workspace-switcher";
import { ReportsDashboard, type ReportIssueItem } from "@/components/reports/reports-dashboard";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = {
  title: "Reports & Analytics",
  description: "Engineering metrics, created vs resolved velocity, and issue age analysis.",
};

export default async function ReportsPage() {
  const context = await getWorkspaceContext();
  const supabase = await createClient();

  if (!context.activeProject) {
    return (
      <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <Surface className="p-12 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border bg-muted text-muted-foreground">
            <FolderKanban className="h-6 w-6" />
          </span>
          <h2 className="text-base font-semibold">No project selected</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Select or create a project to view engineering analytics and reports.
          </p>
          <div className="mt-5 flex justify-center">
            <NewProjectButton organizationId={context.activeOrganization.id} />
          </div>
        </Surface>
      </main>
    );
  }

  const projectId = context.activeProject.id;
  const projectName = context.activeProject.name;
  const projectKey = context.activeProject.key;

  const { data: componentRows, error: componentsError } = await supabase
      .from("components")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("name");
  const issueRows: any[] = [];
  let issueError: { code?: string; message: string } | null = null;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("issues").select("id, issue_number, title, type, priority, severity, created_at, resolved_at, closed_at, status:workflow_states (name, category), component:components (name)").eq("project_id", projectId).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) { issueError = error; break; }
    issueRows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  if (componentsError || issueError) {
    const error = componentsError ?? issueError;
    console.error("Reports load failed", { code: error?.code, message: error?.message });
    return <LoadErrorPage title="Reports unavailable" description="We could not load the complete report dataset. No partial metrics are being shown." retryHref="/dashboard/reports" />;
  }

  const issues: ReportIssueItem[] = issueRows.map((row: any) => ({
    id: row.id,
    issueNumber: row.issue_number,
    title: row.title,
    type: row.type,
    priority: row.priority,
    severity: row.severity,
    statusCategory: row.status?.category ?? "OPEN",
    statusName: row.status?.name ?? "Open",
    componentName: row.component?.name ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
    closedAt: row.closed_at ?? null,
  }));

  const components = (componentRows ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <ReportsDashboard
      projectName={projectName}
      projectKey={projectKey}
      issues={issues}
      components={components}
    />
  );
}
