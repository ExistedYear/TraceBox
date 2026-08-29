import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";

import { NewProjectButton, ProjectCardLink } from "@/components/layout/workspace-switcher";
import { EmptyState } from "@/components/tracebox/primitives";
import { getWorkspaceContext } from "@/lib/workspace-context";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const context = await getWorkspaceContext();

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <div className="mb-8 flex items-end justify-between gap-3">
        <div>
          <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">{context.activeOrganization.name} · Delivery</p>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 text-muted-foreground">Every project in this workspace. Select one to open its issue queue.</p>
        </div>
        {context.activeOrganization.role === "OWNER" || context.activeOrganization.role === "ADMIN" ? <NewProjectButton organizationId={context.activeOrganization.id} /> : null}
      </div>

      {context.projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description={context.activeOrganization.role === "OWNER" || context.activeOrganization.role === "ADMIN" ? "Create your first project to start filing issues." : "Ask a workspace administrator to create the first project."} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {context.projects.map((project) => (
            <li key={project.id}><ProjectCardLink project={project} /></li>
          ))}
        </ul>
      )}
    </main>
  );
}
