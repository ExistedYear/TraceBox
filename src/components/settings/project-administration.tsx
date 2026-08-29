"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, KeyRound, Loader2, RotateCcw, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { projectSettingsSchema, type ProjectSettingsValues } from "@/lib/validation/project-settings";

type Project = { id: string; key: string; name: string; description: string | null; isArchived: boolean };

function mutationMessage(message: string) {
  if (message.includes("PROJECT_ARCHIVED")) return "Restore this project before editing it.";
  if (message.includes("NOT_ALLOWED")) return "Only project maintainers can make this change.";
  if (message.includes("VALIDATION")) return "Check the project values and try again.";
  return "The project could not be updated.";
}

export function ProjectAdministration({ project, canManage }: { project: Project; canManage: boolean }) {
  const router = useRouter();
  const [archived, setArchived] = useState(project.isArchived);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const form = useForm<ProjectSettingsValues>({
    resolver: zodResolver(projectSettingsSchema),
    defaultValues: { name: project.name, description: project.description ?? "" },
  });
  useUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitting, "Discard these unsaved project details?");

  async function save(values: ProjectSettingsValues) {
    try {
      const { error } = await createClient().rpc("update_project_settings", {
        p_project_id: project.id,
        p_name: values.name,
        p_description: values.description || undefined,
      });
      if (error) {
        console.error("Project settings update failed", { code: error.code, message: error.message });
        toast.error(mutationMessage(error.message));
        return;
      }
      form.reset(values);
      toast.success("Project details updated.");
      router.refresh();
    } catch (error) {
      console.error("Unexpected project settings update failure", { error });
      toast.error("Could not reach the server. Try again.");
    }
  }

  async function setArchiveState(next: boolean) {
    const action = next ? "archive" : "restore";
    if (next && !window.confirm(`Archive ${project.key}? Existing data stays available, but project mutations will stop until it is restored.`)) return;
    setLifecycleBusy(true);
    try {
      const { error } = await createClient().rpc("set_project_archived", { p_project_id: project.id, p_archived: next });
      if (error) {
        console.error("Project lifecycle update failed", { code: error.code, message: error.message });
        toast.error(`Could not ${action} the project.`);
        return;
      }
      setArchived(next);
      toast.success(next ? "Project archived." : "Project restored.");
      if (next) router.push("/dashboard/settings");
      router.refresh();
    } catch (error) {
      console.error("Unexpected project lifecycle failure", { error });
      toast.error("Could not reach the server. Try again.");
    } finally {
      setLifecycleBusy(false);
    }
  }

  return (
    <Surface className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Project identity</p>
          <h2 className="mt-1 text-sm font-semibold">Details and lifecycle</h2>
          <p className="mt-1 text-xs text-muted-foreground">The project key is permanent because it is part of every issue identifier and external link.</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"><KeyRound className="h-3 w-3" />{project.key} · immutable</span>
      </div>
      <form onSubmit={form.handleSubmit(save)} className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] lg:items-end">
        <div className="space-y-1.5"><Label htmlFor="project-settings-name">Name</Label><Input id="project-settings-name" disabled={!canManage || archived} {...form.register("name")} />{form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}</div>
        <div className="space-y-1.5"><Label htmlFor="project-settings-description">Description</Label><textarea id="project-settings-description" rows={2} disabled={!canManage || archived} className="flex min-h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" {...form.register("description")} />{form.formState.errors.description && <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>}</div>
        {canManage && <Button type="submit" size="sm" className="h-9" disabled={archived || !form.formState.isDirty || form.formState.isSubmitting}>{form.formState.isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save</Button>}
      </form>
      {canManage && <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/70 pt-4"><div><p className="text-xs font-medium">{archived ? "This project is archived" : "Archive project"}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Archiving preserves issues and configuration while blocking changes.</p></div><Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void setArchiveState(!archived)} disabled={lifecycleBusy}>{lifecycleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}{archived ? "Restore" : "Archive"}</Button></div>}
    </Surface>
  );
}

export function ArchivedProjects({ projects }: { projects: Array<{ id: string; key: string; name: string }> }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function restore(projectId: string) {
    setBusyId(projectId);
    try {
      const { error } = await createClient().rpc("set_project_archived", { p_project_id: projectId, p_archived: false });
      if (error) {
        console.error("Archived project restore failed", { code: error.code, message: error.message });
        toast.error("Could not restore the project.");
        return;
      }
      toast.success("Project restored. Select it from the project switcher.");
      router.refresh();
    } catch (error) {
      console.error("Unexpected archived project restore failure", { error });
      toast.error("Could not reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return <Surface className="mx-auto max-w-3xl p-5"><h1 className="text-lg font-semibold">Archived projects</h1><p className="mt-1 text-sm text-muted-foreground">Restore a project to make it selectable again.</p>{projects.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No archived projects in this workspace.</p> : <ul className="mt-5 divide-y divide-border/70">{projects.map((project) => <li key={project.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{project.name}</p><p className="font-mono text-[10px] text-muted-foreground">{project.key}</p></div><Button size="sm" variant="outline" className="h-8" onClick={() => void restore(project.id)} disabled={busyId !== null}>{busyId === project.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Restore</Button></li>)}</ul>}</Surface>;
}
