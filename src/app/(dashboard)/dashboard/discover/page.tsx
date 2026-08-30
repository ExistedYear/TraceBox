import type { Metadata } from "next";
import { Globe2 } from "lucide-react";

import { PublicWorkspaceDirectory, type PublicWorkspace } from "@/components/workspaces/public-workspace-directory";
import { LoadErrorPage } from "@/components/tracebox/load-error";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Discover workspaces" };

export default async function DiscoverWorkspacesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_public_organizations", { p_limit: 100 });
  if (error) return <LoadErrorPage title="Workspace directory unavailable" description="We could not load public workspaces." retryHref="/dashboard/discover" />;
  return <main className="mx-auto max-w-[1300px] p-4 sm:p-6 lg:p-8"><div className="mb-7 border-b border-border/80 pb-5"><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-primary"><Globe2 className="h-3.5 w-3.5" /> Community directory</p><h1 className="mt-2 text-2xl font-semibold">Discover public workspaces</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Join an open engineering workspace, browse its active projects, and contribute reports with the Reporter role.</p></div><PublicWorkspaceDirectory workspaces={(data ?? []) as PublicWorkspace[]} /></main>;
}
