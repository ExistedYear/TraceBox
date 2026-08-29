import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";

import { Surface } from "@/components/tracebox/primitives";
import { NewProjectButton } from "@/components/layout/workspace-switcher";
import { ReadinessDashboard, type ReadinessSnapshot } from "@/components/readiness/readiness-dashboard";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { normalizeReadinessAnalysis } from "@/lib/readiness";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = {
  title: "Release Readiness",
  description: "Automated release evaluation, blockers analysis, and risk scoring.",
};

export default async function ReadinessPage() {
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
            Select or create a project to assess release readiness.
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

  const [{ data: milestoneRows, error: milestonesError }, { data: versionRows, error: versionsError }, { data: analysisData, error: analysisError }, { data: snapshotRows, error: snapshotsError }] = await Promise.all([
    supabase
      .from("milestones")
      .select("id, name, status, due_at")
      .eq("project_id", projectId)
      .order("due_at", { ascending: true }),
    supabase
      .from("versions")
      .select("id, name, is_released")
      .eq("project_id", projectId)
      .eq("is_archived", false)
      .order("name"),
    supabase.rpc("calculate_release_readiness", { p_project_id: projectId }),
    supabase.rpc("list_release_readiness_snapshots", { p_project_id: projectId, p_limit: 30 }),
  ]);

  if (milestonesError || versionsError || analysisError || snapshotsError) {
    const error = milestonesError ?? versionsError ?? analysisError ?? snapshotsError;
    console.error("Readiness load failed", { code: error?.code, message: error?.message });
    return <LoadErrorPage title="Readiness unavailable" description="We could not load the complete release dataset. No partial score is being shown." retryHref="/dashboard/readiness" />;
  }

  const milestones = (milestoneRows ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    status: m.status,
    dueAt: m.due_at ?? null,
  }));

  const versions = (versionRows ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    isReleased: Boolean(v.is_released),
  }));

  return (
    <ReadinessDashboard
      projectId={projectId}
      projectName={projectName}
      projectKey={projectKey}
      initialAnalysis={normalizeReadinessAnalysis(analysisData, projectKey)}
      snapshots={(snapshotRows ?? []).map((row) => ({
        id: row.id,
        milestoneId: row.milestone_id,
        versionId: row.version_id,
        score: row.score,
        status: row.status,
        breakdown: (row.breakdown ?? {}) as Record<string, unknown>,
        createdAt: row.created_at,
      } satisfies ReadinessSnapshot))}
      milestones={milestones}
      versions={versions}
    />
  );
}
