import type { Metadata } from "next";

import { GithubOperationsDashboard } from "@/components/settings/github-operations-dashboard";
import { LoadError } from "@/components/tracebox/load-error";
import { deriveGithubInstallationHealth, expectedGithubPermissions, githubFailureCategory, type GithubFailureCategory, type GithubOperationDelivery, type GithubOperationInstallation } from "@/lib/github-operations";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "GitHub operations" };

type OperationsPayload = {
  health?: string | null;
  legacy_repo?: string | null;
  installations?: GithubOperationInstallation[];
  repositories?: Array<{ id: string; installation_id: string; github_repository_id: number; full_name: string; private: boolean; archived: boolean; default_branch: string | null; html_url: string; is_accessible: boolean; last_synced_at: string | null; is_primary?: boolean; target_branches?: string[]; auto_resolve_enabled?: boolean }>;
  deliveries?: GithubOperationDelivery[];
  counts?: { processed?: number; failed?: number; terminal?: number; retryable?: number };
};

function asPayload(value: unknown): OperationsPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as OperationsPayload;
}

export default async function GithubOperationsSettingsPage() {
  const context = await getWorkspaceContext();
  if (!context.activeProject) return <LoadError title="GitHub operations unavailable" description="Select a project before opening GitHub operations." retryHref="/dashboard/settings" />;
  const supabase = await createClient();
  const { data: role, error: roleError } = await supabase.rpc("project_role", { p_project_id: context.activeProject.id });
  if (roleError) {
    console.error("GitHub operations permissions load failed", { code: roleError.code, message: roleError.message });
    return <LoadError title="GitHub operations unavailable" description="We could not verify your project permissions. Try again in a moment." retryHref="/dashboard/settings/integrations/operations" />;
  }
  if (role !== "DEVELOPER" && role !== "MAINTAINER") return <LoadError title="GitHub operations unavailable" description="Developer or Maintainer access is required to inspect GitHub operations." retryHref="/dashboard/settings" />;

  // This RPC is the security boundary for the page. It returns only the
  // project-scoped, payload-free read model; raw webhook errors never cross it.
  const { data, error } = await (supabase as any).rpc("get_github_operations", { p_project_id: context.activeProject.id });
  if (error) {
    console.error("GitHub operations load failed", { code: error.code, message: error.message });
    return <LoadError title="GitHub operations unavailable" description="We could not load the sanitized GitHub health summary. Try again in a moment." retryHref="/dashboard/settings/integrations/operations" />;
  }
  const payload = asPayload(data);
  if (!payload) return <LoadError title="GitHub operations unavailable" description="GitHub returned an incomplete operations summary. No partial connection state is being shown." retryHref="/dashboard/settings/integrations/operations" />;

  const installations = (payload.installations ?? []).map((installation) => ({ ...installation, permissions: installation.permissions ?? {}, health: deriveGithubInstallationHealth({ installations: [installation] }), missing_permissions: expectedGithubPermissions(installation.permissions) }));
  const repositories = (payload.repositories ?? []).map((repository) => ({ id: repository.id, github_repository_id: repository.github_repository_id, full_name: repository.full_name, private: repository.private, archived: repository.archived, default_branch: repository.default_branch, html_url: repository.html_url, is_accessible: repository.is_accessible, last_synced_at: repository.last_synced_at, is_primary: repository.is_primary === true, target_branches: repository.target_branches ?? [], auto_resolve_enabled: repository.auto_resolve_enabled !== false }));
  const deliveries = (payload.deliveries ?? []).map((delivery) => ({ delivery_id: delivery.delivery_id, event_name: delivery.event_name, action: delivery.action, github_repository_id: delivery.github_repository_id, status: delivery.status, attempt_count: delivery.attempt_count, received_at: delivery.received_at, last_attempt_at: delivery.last_attempt_at, next_retry_at: delivery.next_retry_at, processed_at: delivery.processed_at, failure_category: delivery.status === "FAILED" ? (delivery.failure_category as GithubFailureCategory | null) ?? githubFailureCategory(null, delivery.attempt_count) : null, retry_eligible: delivery.retry_eligible === true, affected_issues: delivery.affected_issues ?? [] }));
  const counts = { processed: payload.counts?.processed ?? deliveries.filter((delivery) => delivery.status === "PROCESSED").length, failed: payload.counts?.failed ?? deliveries.filter((delivery) => delivery.status === "FAILED").length, terminal: payload.counts?.terminal ?? deliveries.filter((delivery) => delivery.status === "FAILED" && !delivery.retry_eligible).length, retryable: payload.counts?.retryable ?? deliveries.filter((delivery) => delivery.retry_eligible).length };
  const health = (payload.health as Parameters<typeof GithubOperationsDashboard>[0]["health"] | null | undefined) ?? deriveGithubInstallationHealth({ installations, inaccessibleRepositoryCount: repositories.filter((repository) => !repository.is_accessible || repository.archived).length, hasRecentFailures: counts.failed > 0 });

  return <GithubOperationsDashboard projectId={context.activeProject.id} canManage={role === "MAINTAINER"} health={health} legacyRepo={payload.legacy_repo ?? null} installations={installations} repositories={repositories} deliveries={deliveries} counts={counts} />;
}
