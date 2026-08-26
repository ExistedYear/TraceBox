import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
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
          <p className="mt-2 text-muted-foreground">Every project in this workspace. Switch the active one from the sidebar.</p>
        </div>
        <Button asChild size="sm" className="gap-2">
          <Link href="/onboarding?create=1"><Plus className="h-3.5 w-3.5" /> New workspace</Link>
        </Button>
      </div>

      {context.projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Create your first project to start filing issues." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {context.projects.map((project) => (
            <li key={project.id}>
              <Link href="/dashboard/issues" className="block rounded-[10px] border border-border/80 bg-card p-4 transition-colors hover:border-primary/40">
                <p className="font-mono text-xs text-primary">{project.key}</p>
                <p className="mt-1 truncate text-sm font-semibold">{project.name}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
