import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isMissingAuthSession } from "@/lib/supabase/auth-errors";
import type { ProjectSummary, WorkspaceSummary } from "@/components/layout/workspace-switcher";

export type WorkspaceContext = {
  userId: string;
  email: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
  organizations: WorkspaceSummary[];
  activeOrganization: WorkspaceSummary;
  projects: ProjectSummary[];
  activeProject: ProjectSummary | null;
  activeProjectRole: string | null;
};

export class WorkspaceContextLoadError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "WorkspaceContextLoadError";
    this.code = code;
  }
}

// Shared server-side resolution of the cookie-backed workspace/project context.
// cache() dedupes layout + page calls within one request.
export const getWorkspaceContext = cache(async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError && !isMissingAuthSession(userError)) {
    console.error("Workspace authentication lookup failed", { code: userError.code, message: userError.message });
    throw new WorkspaceContextLoadError("Workspace authentication unavailable", userError.code);
  }
  if (!user) redirect("/login");
  const [{ data: profile, error: profileError }, { data: membershipRows, error: membershipError }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
    supabase.from("organization_members").select("role, organization:organizations (id, name, slug)").eq("user_id", user.id).order("joined_at"),
  ]);
  if (profileError || membershipError) {
    const error = profileError || membershipError;
    if (!error) throw new WorkspaceContextLoadError("Workspace context unavailable");
    console.error("Workspace context load failed", { code: error.code, message: error.message });
    throw new WorkspaceContextLoadError("Workspace context unavailable", error.code);
  }
  const organizations = (membershipRows ?? []).flatMap((row) => (row.organization ? [{ ...row.organization, role: row.role }] : []));
  if (organizations.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const requestedOrganizationId = cookieStore.get("tb_org")?.value;
  const activeOrganization = organizations.find((organization) => organization.id === requestedOrganizationId) ?? organizations[0];

  const { data: projectRows, error: projectsError } = await supabase
    .from("projects")
    .select("id, key, name")
    .eq("organization_id", activeOrganization.id)
    .eq("is_archived", false)
    .order("name");

  if (projectsError) {
    console.error("Workspace projects load failed", { code: projectsError.code, message: projectsError.message });
    throw new WorkspaceContextLoadError("Workspace projects unavailable", projectsError.code);
  }

  const projects = projectRows ?? [];
  const requestedProjectId = cookieStore.get("tb_project")?.value;
  const activeProject = projects.find((project) => project.id === requestedProjectId) ?? projects[0] ?? null;
  const { data: activeProjectRole, error: roleError } = activeProject
    ? await supabase.rpc("project_role", { p_project_id: activeProject.id })
    : { data: null, error: null };
  if (roleError) {
    console.error("Active project role load failed", { code: roleError.code, message: roleError.message });
    throw new WorkspaceContextLoadError("Active project role unavailable", roleError.code);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    profile,
    organizations,
    activeOrganization,
    projects,
    activeProject,
    activeProjectRole,
  };
});
