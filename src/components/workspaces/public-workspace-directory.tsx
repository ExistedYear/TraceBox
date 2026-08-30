"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { selectOrganization } from "@/components/layout/workspace-switcher";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/client";

export type PublicWorkspace = { id: string; name: string; slug: string; member_count: number; project_count: number; already_joined: boolean };

export function PublicWorkspaceDirectory({ workspaces }: { workspaces: PublicWorkspace[] }) {
  const router = useRouter();
  const [joining, setJoining] = useState<string | null>(null);

  async function join(workspace: PublicWorkspace) {
    setJoining(workspace.id);
    const { error } = await createClient().rpc("join_public_organization", { p_organization_id: workspace.id });
    setJoining(null);
    if (error) { toast.error("Could not join this workspace."); return; }
    selectOrganization(workspace.id);
    toast.success(`Joined ${workspace.name}.`);
    router.push("/dashboard/projects");
    router.refresh();
  }

  if (workspaces.length === 0) return <Surface className="p-10 text-center"><Users className="mx-auto h-6 w-6 text-muted-foreground" /><h2 className="mt-3 text-sm font-semibold">No public workspaces yet</h2><p className="mt-1 text-sm text-muted-foreground">Workspace administrators can publish a workspace from member settings.</p></Surface>;

  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{workspaces.map((workspace) => <Surface key={workspace.id} className="flex flex-col p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{workspace.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">/{workspace.slug}</p></div>{workspace.already_joined ? <span className="flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300"><Check className="h-3 w-3" /> Joined</span> : null}</div><p className="mt-4 text-xs text-muted-foreground">{workspace.member_count} member{workspace.member_count === 1 ? "" : "s"} · {workspace.project_count} active project{workspace.project_count === 1 ? "" : "s"}</p><Button type="button" size="sm" variant={workspace.already_joined ? "outline" : "default"} className="mt-5 h-8" disabled={joining !== null} onClick={() => workspace.already_joined ? (selectOrganization(workspace.id), router.push("/dashboard/projects"), router.refresh()) : void join(workspace)}>{joining === workspace.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : workspace.already_joined ? "Open workspace" : "Join and contribute"}</Button></Surface>)}</div>;
}
