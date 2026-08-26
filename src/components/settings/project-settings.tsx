"use client";

import { useState } from "react";
import { Archive, ArrowRight, Loader2, Pencil, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { componentSchema, type ComponentValues } from "@/lib/validation/components";

type ComponentRow = {
  id: string;
  name: string;
  description: string | null;
  default_assignee_id: string | null;
  is_archived: boolean;
};

export type StateRow = { id: string; name: string; category: string; position: number; isInitial: boolean; isTerminal: boolean };
export type TransitionRow = { fromStateId: string; toStateId: string };
export type MemberRow = { userId: string; role: string; displayName: string | null };

const categoryTone: Record<string, string> = {
  TRIAGE: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  OPEN: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  IN_PROGRESS: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  REVIEW: "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  RESOLVED: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  CLOSED: "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

function memberLabel(members: MemberRow[], userId: string | null) {
  if (!userId) return "Unassigned";
  return members.find((member) => member.userId === userId)?.displayName ?? "Member";
}

export function ProjectSettings({
  projectId,
  project,
  canManage,
  initialComponents,
  states,
  transitions,
  members,
}: {
  projectId: string;
  project: { key: string; name: string; description: string | null };
  canManage: boolean;
  initialComponents: ComponentRow[];
  states: StateRow[];
  transitions: TransitionRow[];
  members: MemberRow[];
}) {
  const [tab, setTab] = useState<"components" | "workflow">("components");
  const [components, setComponents] = useState(initialComponents);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ComponentRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const form = useForm<ComponentValues>({
    resolver: zodResolver(componentSchema),
    defaultValues: { name: "", description: "", default_assignee_id: "" },
  });
  function openAdd() {
    setEditing(null);
    form.reset({ name: "", description: "", default_assignee_id: "" });
    setAddOpen(true);
  }

  function openEdit(component: ComponentRow) {
    setEditing(component);
    form.reset({
      name: component.name,
      description: component.description ?? "",
      default_assignee_id: component.default_assignee_id ?? "",
    });
    setAddOpen(true);
  }

  async function saveComponent(values: ComponentValues) {
    if (editing) {
      try {
        const { error } = await createClient().rpc("update_component", {
          p_component_id: editing.id,
          p_name: values.name,
          p_description: values.description || undefined,
          p_default_assignee_id: values.default_assignee_id || undefined,
          p_is_archived: editing.is_archived,
        });
        if (error) {
          toast.error(/duplicate key/i.test(error.message) ? "A component with that name exists." : "Could not update the component.");
          return;
        }
        setComponents((current) => current.map((row) => (row.id === editing.id ? { ...row, name: values.name, description: values.description || null, default_assignee_id: values.default_assignee_id || null } : row)).sort((a, b) => a.name.localeCompare(b.name)));
        toast.success("Component updated.");
      } catch {
        toast.error("Could not reach the server. Please try again.");
        return;
      }
    } else {
      await addComponent(values);
      return;
    }
    form.reset({ name: "", description: "", default_assignee_id: "" });
    setEditing(null);
    setAddOpen(false);
  }

  async function addComponent(values: ComponentValues) {
    try {
      const { data: componentId, error } = await createClient().rpc("create_component", {
        p_project_id: projectId,
        p_name: values.name,
        p_description: values.description || undefined,
        p_default_assignee_id: values.default_assignee_id || undefined,
      });
      if (error) {
        toast.error(/duplicate key/i.test(error.message) ? "A component with that name exists." : "Could not create the component.");
        return;
      }
      const data = {
        id: componentId,
        name: values.name,
        description: values.description || null,
        default_assignee_id: values.default_assignee_id || null,
        is_archived: false,
      };
      setComponents((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(`Component ${data.name} created.`);
      form.reset({ name: "", description: "", default_assignee_id: "" });
      setAddOpen(false);
    } catch {
      toast.error("Could not reach the server. Please try again.");
    }
  }

  async function toggleArchive(component: ComponentRow) {
    setBusyId(component.id);
    try {
      const { error } = await createClient().rpc("update_component", {
        p_component_id: component.id,
        p_name: component.name,
        p_description: component.description || undefined,
        p_default_assignee_id: component.default_assignee_id || undefined,
        p_is_archived: !component.is_archived,
      });
      if (error) {
        toast.error(error.message.includes("PROJECT_ARCHIVED") ? "This project is archived." : error.message.includes("NOT_ALLOWED") ? "Only maintainers can archive components." : "Could not update the component.");
        return;
      }
      setComponents((current) => current.map((row) => (row.id === component.id ? { ...row, is_archived: !row.is_archived } : row)));
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusyId((current) => (current === component.id ? null : current));
    }
  }

  const stateName = (id: string) => states.find((state) => state.id === id)?.name ?? "?";

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">Project settings</p>
        <h1 className="text-3xl font-semibold tracking-tight"><span className="font-mono text-primary">{project.key}</span> · {project.name}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{project.description ?? "Components and workflow for this project."}</p>
      </div>

      <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-border/80">
        {(["components", "workflow"] as const).map((value) => (
          <button key={value} id={`tab-${value}`} aria-controls={`panel-${value}`} onClick={() => setTab(value)} role="tab" aria-selected={tab === value} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize", tab === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {value}
          </button>
        ))}
      </div>

      {tab === "components" ? (
        <div role="tabpanel" id="panel-components" aria-labelledby="tab-components">
          <Surface>
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Components</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Group issues by area; a default assignee can be preselected at creation.</p>
            </div>
            {canManage && (
              <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) { setEditing(null); form.reset({ name: "", description: "", default_assignee_id: "" }); } }}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add component</Button>
                </DialogTrigger>
                <DialogContent className="max-w-md rounded-[10px]">
                  <DialogHeader>
                    <DialogTitle className="text-base">{editing ? "Edit component" : "New component"}</DialogTitle>
                    <DialogDescription>Component names are unique within the project.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={form.handleSubmit(saveComponent)} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="component-name">Name</Label>
                      <Input id="component-name" placeholder="Authentication" {...form.register("name")} />
                      {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="component-description">Description <span className="text-muted-foreground">(optional)</span></Label>
                      <Input id="component-description" placeholder="What this component covers" {...form.register("description")} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="component-assignee">Default assignee</Label>
                      <select id="component-assignee" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" {...form.register("default_assignee_id")}>
                        <option value="">Unassigned</option>
                        {members.map((member) => (
                          <option key={member.userId} value={member.userId}>{member.displayName ?? member.userId.slice(0, 8)}</option>
                        ))}
                      </select>
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        {editing ? "Save changes" : "Create component"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
          {components.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No components yet.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {components.map((component) => (
                <li key={component.id} className={cn("flex items-center gap-3 px-4 py-2.5", component.is_archived && "opacity-55")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{component.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{component.description ?? memberLabel(members, component.default_assignee_id)}</p>
                  </div>
                  {canManage && (
                    <>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => openEdit(component)}>
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => toggleArchive(component)} disabled={busyId === component.id}>
                        {busyId === component.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                        {component.is_archived ? "Restore" : "Archive"}
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          </Surface>
        </div>
      ) : (
        <div role="tabpanel" id="panel-workflow" aria-labelledby="tab-workflow" className="grid gap-3 lg:grid-cols-2">
          <Card className="rounded-[10px] border-border/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">States</CardTitle>
              <CardDescription className="text-xs">Every new issue starts in the initial state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {states.map((state) => (
                <div key={state.id} className="flex items-center gap-2 text-sm">
                  <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground">{state.position}</span>
                  <span className="min-w-0 flex-1 truncate">{state.name}{state.isInitial && <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-primary">initial</span>}{state.isTerminal && <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">terminal</span>}</span>
                  <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide", categoryTone[state.category])}>{state.category.replace("_", " ").toLowerCase()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-[10px] border-border/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Transitions</CardTitle>
              <CardDescription className="text-xs">Allowed moves between states.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {transitions.map((transition) => (
                <span key={`${transition.fromStateId}->${transition.toStateId}`} className="flex items-center gap-1 text-xs text-muted-foreground">
                  {stateName(transition.fromStateId)} <ArrowRight className="h-3 w-3" /> {stateName(transition.toStateId)}
                </span>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
