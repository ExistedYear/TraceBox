import Link from "next/link";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/tracebox/primitives";
import { getWorkspaceContext, WorkspaceContextLoadError } from "@/lib/workspace-context";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // cache() dedupes this with per-page getWorkspaceContext() calls.
  let context;
  try {
    context = await getWorkspaceContext();
  } catch (error) {
    if (!(error instanceof WorkspaceContextLoadError)) throw error;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <Surface className="max-w-md border-destructive/30 p-8 text-center">
          <h1 className="text-lg font-semibold">Workspace unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">We could not load your workspace safely. No empty workspace was inferred.</p>
          <Button asChild variant="outline" className="mt-5"><Link href="/dashboard">Retry</Link></Button>
        </Surface>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        organizations={context.organizations}
        projects={context.projects}
        activeOrganizationId={context.activeOrganization.id}
        activeProjectId={context.activeProject?.id ?? null}
        canCreateIssue={context.activeProjectRole === "REPORTER" || context.activeProjectRole === "DEVELOPER" || context.activeProjectRole === "MAINTAINER"}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          userId={context.userId}
          email={context.email}
          displayName={context.profile?.display_name}
          avatarUrl={context.profile?.avatar_url}
          workspaceName={context.activeOrganization.name}
          projectName={context.projects.find((project) => project.id === context.activeProject?.id)?.name ?? null}
          organizations={context.organizations}
          projects={context.projects}
          activeOrganizationId={context.activeOrganization.id}
          activeProjectId={context.activeProject?.id ?? null}
          activeProjectRole={context.activeProjectRole}
        />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
