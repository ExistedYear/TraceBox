import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";

import { SettingsNavigation } from "@/components/settings/settings-navigation";
import { LoadError } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace-context";

export default async function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await getWorkspaceContext();
  if (!context.activeProject) return children;

  const supabase = await createClient();
  const { data: role, error: roleError } = await supabase.rpc("project_role", { p_project_id: context.activeProject.id });
  if (roleError) {
    console.error("Settings authorization load failed", { code: roleError.code, message: roleError.message });
    return <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8"><LoadError title="Settings unavailable" description="We could not verify your project settings access." retryHref="/dashboard/settings" /></main>;
  }
  const canAccessDeveloperSettings = role === "DEVELOPER" || role === "MAINTAINER";

  return (
    <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/dashboard" className="transition-colors hover:text-foreground">Overview</Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
        <span className="font-mono text-primary">{context.activeProject.key}</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden="true" />
        <span>Settings</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Project administration</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">Project settings</h1>
          <p className="mt-1 text-sm text-muted-foreground"><span className="font-mono text-foreground">{context.activeProject.key}</span> · {context.activeProject.name}</p>
        </div>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-card px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> {role ? role.toLowerCase() : "member"}</span>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNavigation canAccessDeveloperSettings={canAccessDeveloperSettings} />
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
