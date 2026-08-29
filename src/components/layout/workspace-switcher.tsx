"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, FolderKanban, Loader2, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSafeWorkspaceErrorMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { projectSchema, type ProjectValues } from "@/lib/validation/workspace";

export type WorkspaceSummary = { id: string; name: string; slug: string };
export type ProjectSummary = { id: string; key: string; name: string };

type WorkspaceSwitcherProps = {
  organizations: WorkspaceSummary[];
  projects: ProjectSummary[];
  activeOrganizationId: string;
  activeProjectId: string | null;
  onContextChange?: () => void;
};

export function selectOrganization(id: string) {
  // One year, scoped to the app; server layout validates against real memberships.
  document.cookie = `tb_org=${id}; path=/; max-age=31536000; samesite=lax`;
  document.cookie = "tb_project=; path=/; max-age=0; samesite=lax";
}

export function selectProject(id: string) {
  document.cookie = `tb_project=${id}; path=/; max-age=31536000; samesite=lax`;
}

export function WorkspaceSwitcher({ organizations, projects, activeOrganizationId, activeProjectId, onContextChange }: WorkspaceSwitcherProps) {
  const router = useRouter();
  const activeOrganization = organizations.find((organization) => organization.id === activeOrganizationId);
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 px-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">Workspace</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-auto w-full justify-between gap-2 px-2.5 py-2 text-left" title={activeOrganization?.name} aria-label={`Workspace: ${activeOrganization?.name ?? "No workspace"}`}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-primary">{activeOrganization?.name.slice(0, 1).toUpperCase() ?? "?"}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{activeOrganization?.name ?? "No workspace"}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Workspaces</DropdownMenuLabel>
          {organizations.map((organization) => (
            <DropdownMenuItem key={organization.id} onSelect={() => { selectOrganization(organization.id); router.push("/dashboard"); router.refresh(); onContextChange?.(); }}>
              <span className="min-w-0 flex-1 truncate">{organization.name}</span>
              {organization.id === activeOrganizationId && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/onboarding?create=1"><Plus className="mr-2 h-4 w-4" />New workspace</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>

      <div>
      <p className="mb-1 px-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">Project</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-auto w-full justify-between gap-2 px-2.5 py-1.5 text-left" title={activeProject?.name} aria-label={`Project: ${activeProject ? `${activeProject.key} · ${activeProject.name}` : "No project selected"}`}>
            <span className="flex min-w-0 items-center gap-2">
              <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{activeProject ? <><span className="font-mono">{activeProject.key}</span> · {activeProject.name}</> : "No project selected"}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Projects</DropdownMenuLabel>
          {projects.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects yet.</p>}
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => { selectProject(project.id); router.push("/dashboard/issues"); router.refresh(); onContextChange?.(); }}>
              <span className="font-mono text-xs">{project.key}</span>
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {project.id === activeProjectId && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNewProjectOpen(true)}><Plus className="mr-2 h-4 w-4" />New project</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        organizationId={activeOrganizationId}
        onCreated={(projectId) => {
          selectProject(projectId);
          router.push("/dashboard/issues");
          router.refresh();
        }}
      />
    </div>
  );
}

export function NewProjectButton({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> New project
      </Button>
      <NewProjectDialog
        open={open}
        onOpenChange={setOpen}
        organizationId={organizationId}
        onCreated={(projectId) => {
          selectProject(projectId);
          router.push("/dashboard/issues");
          router.refresh();
        }}
      />
    </>
  );
}
export function ProjectCardLink({ project }: { project: ProjectSummary }) {
  return (
    <Link
      href="/dashboard/issues"
      prefetch={false}
      onClick={() => selectProject(project.id)}
      className="block rounded-[10px] border border-border/80 bg-card p-4 transition-colors hover:border-primary/40"
    >
      <p className="font-mono text-xs text-primary">{project.key}</p>
      <p className="mt-1 truncate text-sm font-semibold">{project.name}</p>
    </Link>
  );
}

function NewProjectDialog({ open, onOpenChange, organizationId, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; organizationId: string; onCreated: (projectId: string) => void }) {
  const form = useForm<ProjectValues>({ resolver: zodResolver(projectSchema), defaultValues: { name: "", key: "", description: "" } });

  async function onSubmit(values: ProjectValues) {
    if (!organizationId) {
      toast.error("No active workspace selected.");
      return;
    }
    try {
      const { data, error } = await createClient().rpc("create_project", {
        p_organization_id: organizationId,
        p_name: values.name.trim(),
        p_key: values.key.trim().toUpperCase(),
        p_description: values.description ? values.description.trim() : undefined,
      });
      if (error) {
        console.error("Project creation failed:", error);
        toast.error(getSafeWorkspaceErrorMessage(error));
        return;
      }
      toast.success(`Project ${values.key.trim().toUpperCase()} created.`);
      form.reset();
      onOpenChange(false);
      onCreated(data);
    } catch (err) {
      console.error("Unexpected project creation error:", err);
      toast.error("Could not reach the server. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[10px] border-border/80">
        <DialogHeader>
          <DialogTitle className="text-base">New project</DialogTitle>
          <DialogDescription>Issues will be numbered with its key, like AUTH-1.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <div className="space-y-2">
              <Label htmlFor="dialog-project-name">Name</Label>
              <Input id="dialog-project-name" placeholder="project name" {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialog-project-key">Key</Label>
              <Input id="dialog-project-key" className="font-mono uppercase" placeholder="CORE" {...form.register("key")} onChange={(event) => { form.setValue("key", event.target.value.toUpperCase(), { shouldValidate: true, shouldDirty: true }); }} />
              {form.formState.errors.key && <p className="text-xs text-destructive">{form.formState.errors.key.message}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dialog-project-description">Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="dialog-project-description" placeholder="project scope or description" {...form.register("description")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
