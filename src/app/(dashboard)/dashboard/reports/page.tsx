import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { NewProjectButton } from "@/components/layout/workspace-switcher";
import { ReportsDashboard } from "@/components/reports/reports-dashboard";
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
  const { data: reportMetrics, error: reportError } = await supabase.rpc("get_issue_reports", { p_project_id: projectId, p_window_days: 30 });

  if (componentsError || reportError) {
    const error = componentsError ?? reportError;
    console.error("Reports load failed", { code: error?.code, message: error?.message });
    return <LoadErrorPage title="Reports unavailable" description="We could not load the complete report dataset. No partial metrics are being shown." retryHref="/dashboard/reports" />;
  }

  const components = (componentRows ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <ReportsDashboard
      projectName={projectName}
      projectKey={projectKey}
      projectId={projectId}
      initialMetrics={reportMetrics as unknown as Record<string, unknown>}
      components={components}
    />
  );
}
