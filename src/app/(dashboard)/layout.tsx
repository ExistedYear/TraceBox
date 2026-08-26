import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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

  const { data: projects } = await supabase
    .from("projects")
    .select("id, key, name")
    .eq("organization_id", activeOrganization.id)
    .eq("is_archived", false)
    .order("name");

  const projectList = projects ?? [];
  const requestedProjectId = cookieStore.get("tb_project")?.value;
  const activeProjectId = projectList.find((project) => project.id === requestedProjectId)?.id ?? null;

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar organizations={organizations} projects={projectList} activeOrganizationId={activeOrganization.id} activeProjectId={activeProjectId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          email={user.email ?? ""}
          displayName={profile?.display_name}
          avatarUrl={profile?.avatar_url}
          workspaceName={activeOrganization.name}
          projectName={projectList.find((project) => project.id === activeProjectId)?.name ?? null}
          organizations={organizations}
          projects={projectList}
          activeOrganizationId={activeOrganization.id}
          activeProjectId={activeProjectId}
        />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
