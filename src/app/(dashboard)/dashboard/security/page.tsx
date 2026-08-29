import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { SecurityIssueQueue, type SecurityAccessEvent, type SecurityIssue } from "@/components/security/security-issue-queue";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { EmptyState } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/server";
import { displayNameMap } from "@/lib/server-people";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Security issues" };

export default async function SecurityIssuesPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) {
    return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><EmptyState icon={ShieldAlert} title="No project selected" description="Pick a project from the sidebar switcher to review restricted security issues." /></main>;
  }

  const supabase = await createClient();
  const { data: issueRows, error: issueError } = await supabase
    .from("issues")
    .select("id, issue_number, title, severity, priority, updated_at, status:workflow_states(name, category)")
    .eq("project_id", context.activeProject.id)
    .eq("visibility", "RESTRICTED")
    .order("updated_at", { ascending: false });
  if (issueError) {
    console.error("Security issue queue load failed", { code: issueError.code, message: issueError.message });
    return <LoadErrorPage title="Security queue unavailable" description="Restricted issues could not be loaded. No partial security results are shown." retryHref="/dashboard/security" />;
  }

  const issueIds = (issueRows ?? []).map((issue) => issue.id);
  let accessEvents: SecurityAccessEvent[] = [];
  if (issueIds.length) {
    const { data: eventRows, error: eventError } = await supabase
      .from("issue_events")
      .select("id, issue_id, actor_id, event_type, old_value, new_value, metadata, created_at")
      .in("issue_id", issueIds)
      .in("event_type", ["ACCESS_GRANTED", "ACCESS_REVOKED"])
      .order("created_at", { ascending: false });
    if (eventError) {
      console.error("Security access history load failed", { code: eventError.code, message: eventError.message });
      return <LoadErrorPage title="Security history unavailable" description="Access history could not be loaded. No partial security results are shown." retryHref="/dashboard/security" />;
    }
    accessEvents = (eventRows ?? []) as SecurityAccessEvent[];
  }

  const targetIds = accessEvents.flatMap((event) => {
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : null;
    const target = typeof metadata?.target_user_id === "string" ? metadata.target_user_id : null;
    return [event.actor_id, target];
  });
  const names = await displayNameMap(targetIds);
  const issues: SecurityIssue[] = (issueRows ?? []).map((issue) => ({
    ...issue,
    status: Array.isArray(issue.status) ? issue.status[0] ?? null : issue.status,
  })) as SecurityIssue[];

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6 border-b border-border/80 pb-5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Security workspace</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl"><ShieldAlert className="h-6 w-6 text-amber-400" /> Restricted issues</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review confidential issues and their access changes. Results are limited by database-enforced issue visibility.</p>
      </div>
      <SecurityIssueQueue projectKey={context.activeProject.key} issues={issues} accessEvents={accessEvents} names={names} />
    </main>
  );
}
