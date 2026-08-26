import { redirect } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { getWorkspaceContext } from "@/lib/workspace-context";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // cache() dedupes this with per-page getWorkspaceContext() calls.
  const context = await getWorkspaceContext();

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        organizations={context.organizations}
        projects={context.projects}
        activeOrganizationId={context.activeOrganization.id}
        activeProjectId={context.activeProject?.id ?? null}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          email={context.email}
          displayName={context.profile?.display_name}
          avatarUrl={context.profile?.avatar_url}
          workspaceName={context.activeOrganization.name}
          projectName={context.projects.find((project) => project.id === context.activeProject?.id)?.name ?? null}
          organizations={context.organizations}
          projects={context.projects}
          activeOrganizationId={context.activeOrganization.id}
          activeProjectId={context.activeProject?.id ?? null}
        />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
