import type { Metadata } from "next";
import { AuditExplorer, type AuditOption, type AuditRow } from "@/components/audit/audit-explorer";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { humanizeEnum, formatIssueKey, personLabel } from "@/lib/issues";
import { displayNameMap } from "@/lib/server-people";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";
export const metadata: Metadata = { title: "Audit explorer" };

const AUDIT_ACTIONS = [
  "ISSUE_CREATED", "STATUS_CHANGED", "RESOLUTION_CHANGED", "ASSIGNEE_CHANGED", "PRIORITY_CHANGED", "SEVERITY_CHANGED", "TYPE_CHANGED",
  "TITLE_CHANGED", "DESCRIPTION_CHANGED", "ENVIRONMENT_CHANGED", "EXPECTED_BEHAVIOR_CHANGED", "ACTUAL_BEHAVIOR_CHANGED", "COMPONENT_CHANGED",
  "VERSION_CHANGED", "MILESTONE_CHANGED", "LABEL_CHANGED", "PLANNING_CHANGED", "CUSTOM_FIELD_UPDATED", "VISIBILITY_CHANGED", "ACCESS_GRANTED",
  "ACCESS_REVOKED", "COMMENT_ADDED", "COMMENT_EDITED", "ATTACHMENT_ADDED", "ATTACHMENT_DELETED", "ISSUE_LINKED", "ISSUE_UNLINKED", "GITHUB_LINKED",
  "GITHUB_UNLINKED", "GITHUB_LINK_REMOVED", "GITHUB_LINK_UPDATED", "GITHUB_UPDATED", "WATCHED_ISSUE_UPDATED", "GITHUB_PR_MERGED", "GITHUB_CHECKS_PASSED", "GITHUB_CHECKS_FAILED",
].map((value) => ({ value, label: humanizeEnum(value) } satisfies AuditOption));

export default async function AuditPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) return <LoadErrorPage title="Audit unavailable" description="Select a project to view its audit history." retryHref="/dashboard" />;
  const supabase = await createClient();
  const projectId = context.activeProject.id;
  const [{ data: auditRows, error: auditError }, { data: memberRows, error: memberError }, { data: adminRows, error: adminError }, { data: issueRows, error: issueError }] = await Promise.all([
    supabase.rpc("list_project_audit_events", { p_project_id: projectId, p_limit: 50, p_offset: 0 }),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    supabase.from("organization_members").select("user_id").eq("organization_id", context.activeOrganization.id).in("role", ["OWNER", "ADMIN"]),
    supabase.from("issues").select("id, issue_number, title").eq("project_id", projectId).order("issue_number", { ascending: false }).limit(500),
  ]);
  const queryError = auditError ?? memberError ?? adminError ?? issueError;
  if (queryError) {
    console.error("Audit explorer load failed", { code: queryError.code, message: queryError.message });
    return <LoadErrorPage title="Audit unavailable" description="We could not load the authorized project audit history." retryHref="/dashboard/audit" />;
  }
  const candidates = [...(memberRows ?? []), ...(adminRows ?? [])];
  const names = await displayNameMap(candidates.map((row) => row.user_id));
  const actors = [...new Map(candidates.map((row) => [row.user_id, { value: row.user_id, label: personLabel(names.get(row.user_id), row.user_id) }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const issues = (issueRows ?? []).map((row) => ({ value: row.id, label: `${formatIssueKey(context.activeProject!.key, row.issue_number)} · ${row.title}` }));
  const rows = (auditRows ?? []) as AuditRow[];
  return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><div className="mb-6 border-b border-border/80 pb-5"><p className="font-mono text-[10px] uppercase tracking-wider text-primary">{context.activeProject.key} · Operations</p><h1 className="mt-1 text-2xl font-semibold">Audit explorer</h1><p className="mt-1 text-sm text-muted-foreground">Read-only authorized activity for this project. Restricted issues and cross-issue references remain redacted.</p></div><AuditExplorer projectId={projectId} initialRows={rows} initialTotal={Number(rows[0]?.total_count ?? 0)} actors={actors} actions={AUDIT_ACTIONS} issues={issues} /></main>;
}
