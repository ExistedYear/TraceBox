import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { ProjectSummary, WorkspaceSummary } from "@/components/layout/workspace-switcher";

export type WorkspaceContext = {
  userId: string;
  email: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
  organizations: WorkspaceSummary[];
  activeOrganization: WorkspaceSummary;
  projects: ProjectSummary[];
  activeProject: ProjectSummary | null;
};

// Shared server-side resolution of the cookie-backed workspace/project context.
// cache() dedupes layout + page calls within one request.
export const getWorkspaceContext = cache(async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle();

  const { data: membershipRows } = await supabase
    .from("organization_members")
    .select("organization:organizations (id, name, slug)")
    .order("joined_at");
  const organizations = (membershipRows ?? []).flatMap((row) => (row.organization ? [row.organization] : []));
  if (organizations.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const requestedOrganizationId = cookieStore.get("tb_org")?.value;
  const activeOrganization = organizations.find((organization) => organization.id === requestedOrganizationId) ?? organizations[0];

  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, key, name")
    .eq("organization_id", activeOrganization.id)
    .eq("is_archived", false)
    .order("name");

  const projects = projectRows ?? [];
  const requestedProjectId = cookieStore.get("tb_project")?.value;
  const activeProject = projects.find((project) => project.id === requestedProjectId) ?? null;

  return {
    userId: user.id,
    email: user.email ?? "",
    profile,
    organizations,
    activeOrganization,
    projects,
    activeProject,
  };
});
