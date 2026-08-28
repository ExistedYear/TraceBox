"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Layers3,
  Loader2,
  Milestone,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { componentSchema, type ComponentValues } from "@/lib/validation/components";
import {
  labelSchema,
  versionSchema,
  milestoneSchema,
  MILESTONE_STATUSES,
  type LabelValues,
  type VersionValues,
  type MilestoneValues,
} from "@/lib/validation/planning";

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}
function safeColor(value: string): string {
  return isHexColor(value) ? value : "#6366f1";
}

export type ComponentRow = {
  id: string;
  name: string;
  description: string | null;
  default_assignee_id: string | null;
  is_archived: boolean;
};

export type LabelRow = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at?: string;
};

export type VersionRow = {
  id: string;
  name: string;
  description: string | null;
  released_at: string | null;
  is_released: boolean;
  is_archived: boolean;
};

export type MilestoneRow = {
  id: string;
  name: string;
  description: string | null;
  due_at: string | null;
  status: string;
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

type TabType = "components" | "labels" | "versions" | "milestones" | "workflow";

export function ProjectSettings({
  projectId,
  project,
  canManage,
  initialComponents,
  initialLabels = [],
  initialVersions = [],
  initialMilestones = [],
  states,
  transitions,
  members,
}: {
  projectId: string;
  project: { key: string; name: string; description: string | null };
  canManage: boolean;
  initialComponents: ComponentRow[];
  initialLabels?: LabelRow[];
  initialVersions?: VersionRow[];
  initialMilestones?: MilestoneRow[];
  states: StateRow[];
  transitions: TransitionRow[];
  members: MemberRow[];
}) {
  const [tab, setTab] = useState<TabType>("components");

  // Components State
  const [components, setComponents] = useState(initialComponents);
  const [compAddOpen, setCompAddOpen] = useState(false);
  const [editingComp, setEditingComp] = useState<ComponentRow | null>(null);
  const [compBusyId, setCompBusyId] = useState<string | null>(null);

  // Labels State
  const [labels, setLabels] = useState<LabelRow[]>(initialLabels);
  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<LabelRow | null>(null);

  // Versions State
  const [versions, setVersions] = useState<VersionRow[]>(initialVersions);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [editingVersion, setEditingVersion] = useState<VersionRow | null>(null);

  // Milestones State
  const [milestones, setMilestones] = useState<MilestoneRow[]>(initialMilestones);
  const [milestoneModalOpen, setMilestoneModalOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<MilestoneRow | null>(null);

  // Form Hooks
  const compForm = useForm<ComponentValues>({
    resolver: zodResolver(componentSchema),
    defaultValues: { name: "", description: "", default_assignee_id: "" },
  });

  const labelForm = useForm<LabelValues>({
    resolver: zodResolver(labelSchema),
    defaultValues: { name: "", color: "#6366f1", description: "" },
  });

  const versionForm = useForm<VersionValues>({
    resolver: zodResolver(versionSchema),
    defaultValues: { name: "", description: "", released_at: "", is_released: false },
  });

  const milestoneForm = useForm<MilestoneValues>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: { name: "", description: "", due_at: "", status: "ACTIVE" },
  });

  // Component Actions
  function openAddComp() {
    setEditingComp(null);
    compForm.reset({ name: "", description: "", default_assignee_id: "" });
    setCompAddOpen(true);
  }

  function openEditComp(component: ComponentRow) {
    setEditingComp(component);
    compForm.reset({
      name: component.name,
      description: component.description ?? "",
      default_assignee_id: component.default_assignee_id ?? "",
    });
    setCompAddOpen(true);
  }

  async function saveComponent(values: ComponentValues) {
    if (editingComp) {
      try {
        const { error } = await createClient().rpc("update_component", {
          p_component_id: editingComp.id,
          p_name: values.name.trim(),
          p_description: values.description ? values.description.trim() : undefined,
          p_default_assignee_id: values.default_assignee_id || undefined,
          p_is_archived: editingComp.is_archived,
        });
        if (error) {
          console.error("Component update failed:", error);
          toast.error(/duplicate key/i.test(error.message) ? "A component with that name exists." : "Could not update the component.");
          return;
        }
        setComponents((current) => current.map((row) => (row.id === editingComp.id ? { ...row, name: values.name.trim(), description: values.description ? values.description.trim() : null, default_assignee_id: values.default_assignee_id || null } : row)).sort((a, b) => a.name.localeCompare(b.name)));
        toast.success("Component updated.");
      } catch (err) {
        console.error("Unexpected component update error:", err);
        toast.error("Could not reach the server. Please try again.");
        return;
      }
    } else {
      try {
        const { data: componentId, error } = await createClient().rpc("create_component", {
          p_project_id: projectId,
          p_name: values.name.trim(),
          p_description: values.description ? values.description.trim() : undefined,
          p_default_assignee_id: values.default_assignee_id || undefined,
        });
        if (error) {
          console.error("Component creation failed:", error);
          toast.error(/duplicate key/i.test(error.message) ? "A component with that name exists." : "Could not create the component.");
          return;
        }
        const data = {
          id: componentId,
          name: values.name.trim(),
          description: values.description ? values.description.trim() : null,
          default_assignee_id: values.default_assignee_id || null,
          is_archived: false,
        };
        setComponents((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(`Component ${data.name} created.`);
      } catch (err) {
        console.error("Unexpected component creation error:", err);
        toast.error("Could not reach the server. Please try again.");
        return;
      }
    }
    compForm.reset({ name: "", description: "", default_assignee_id: "" });
    setEditingComp(null);
    setCompAddOpen(false);
  }

  async function toggleArchiveComp(component: ComponentRow) {
    setCompBusyId(component.id);
    try {
      const { error } = await createClient().rpc("update_component", {
        p_component_id: component.id,
        p_name: component.name,
        p_description: component.description || undefined,
        p_default_assignee_id: component.default_assignee_id || undefined,
        p_is_archived: !component.is_archived,
      });
      if (error) {
        console.error("Component archive toggle failed:", error);
        toast.error(error.message.includes("PROJECT_ARCHIVED") ? "This project is archived." : error.message.includes("NOT_ALLOWED") ? "Only maintainers can archive components." : "Could not update the component.");
        return;
      }
      setComponents((current) => current.map((row) => (row.id === component.id ? { ...row, is_archived: !row.is_archived } : row)));
    } catch (err) {
      console.error("Unexpected component archive error:", err);
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setCompBusyId((current) => (current === component.id ? null : current));
    }
  }

  // Label Actions
  function openAddLabel() {
    setEditingLabel(null);
    labelForm.reset({ name: "", color: "#6366f1", description: "" });
    setLabelModalOpen(true);
  }

  function openEditLabel(label: LabelRow) {
    setEditingLabel(label);
    labelForm.reset({ name: label.name, color: label.color, description: label.description ?? "" });
    setLabelModalOpen(true);
  }
  async function saveLabel(values: LabelValues) {
    if (editingLabel) {
      try {
        const { error } = await createClient().rpc("update_label", {
          p_label_id: editingLabel.id,
          p_name: values.name.trim(),
          p_color: values.color.trim(),
          p_description: values.description ? values.description.trim() : undefined,
        });
        if (error) {
          toast.error("Could not update label.");
          return;
        }
        setLabels((prev) => prev.map((l) => (l.id === editingLabel.id ? { ...l, name: values.name.trim(), color: values.color.trim(), description: values.description ? values.description.trim() : null } : l)).sort((a, b) => a.name.localeCompare(b.name)));
        toast.success("Label updated.");
      } catch {
        toast.error("Could not reach the server.");
      }
    } else {
      try {
        const { data, error } = await createClient().rpc("create_label", {
          p_project_id: projectId,
          p_name: values.name.trim(),
          p_color: values.color.trim(),
          p_description: values.description ? values.description.trim() : undefined,
        });
        if (error) {
          toast.error("Could not create label.");
          return;
        }
        const newL: LabelRow = { id: String(data), name: values.name.trim(), color: values.color.trim(), description: values.description ? values.description.trim() : null };
        setLabels((prev) => [...prev, newL].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success("Label created.");
      } catch {
        toast.error("Could not reach the server.");
      }
    }
    setLabelModalOpen(false);
    setEditingLabel(null);
  }

  async function deleteLabel(id: string) {
    if (!window.confirm("Are you sure you want to delete this label? It will be removed from all issues.")) {
      return;
    }
    try {
      const { error } = await createClient().rpc("delete_label", { p_label_id: id });
      if (error) {
        toast.error("Could not delete label.");
        return;
      }
      setLabels((prev) => prev.filter((l) => l.id !== id));
      toast.success("Label deleted.");
    } catch {
      toast.error("Could not reach the server.");
    }
  }

  // Version Actions
  function openAddVersion() {
    setEditingVersion(null);
    versionForm.reset({ name: "", description: "", released_at: "", is_released: false });
    setVersionModalOpen(true);
  }

  function openEditVersion(version: VersionRow) {
    setEditingVersion(version);
    versionForm.reset({
      name: version.name,
      description: version.description ?? "",
      released_at: version.released_at ? version.released_at.split("T")[0] : "",
      is_released: version.is_released,
    });
    setVersionModalOpen(true);
  }

  async function saveVersion(values: VersionValues) {
    if (editingVersion) {
      try {
        const { error } = await createClient().rpc("update_version", {
          p_version_id: editingVersion.id,
          p_name: values.name.trim(),
          p_description: values.description ? values.description.trim() : undefined,
          p_released_at: values.released_at ? new Date(values.released_at).toISOString() : undefined,
          p_is_released: values.is_released,
          p_is_archived: editingVersion.is_archived,
        });
        if (error) {
          toast.error("Could not update version.");
          return;
        }
        setVersions((prev) => prev.map((v) => (v.id === editingVersion.id ? { ...v, name: values.name.trim(), description: values.description ? values.description.trim() : null, is_released: values.is_released, released_at: values.released_at || null } : v)));
        toast.success("Version updated.");
      } catch {
        toast.error("Could not reach the server.");
      }
    } else {
      try {
        const { data, error } = await createClient().rpc("create_version", {
          p_project_id: projectId,
          p_name: values.name.trim(),
          p_description: values.description ? values.description.trim() : undefined,
          p_released_at: values.released_at ? new Date(values.released_at).toISOString() : undefined,
          p_is_released: values.is_released,
        });
        if (error) {
          toast.error("Could not create version.");
          return;
        }
        const newV: VersionRow = { id: String(data), name: values.name.trim(), description: values.description ? values.description.trim() : null, is_released: values.is_released, released_at: values.released_at || null, is_archived: false };
        setVersions((prev) => [...prev, newV]);
        toast.success("Version created.");
      } catch {
        toast.error("Could not reach the server.");
      }
    }
    setVersionModalOpen(false);
    setEditingVersion(null);
  }

  async function toggleArchiveVersion(version: VersionRow) {
    try {
      const { error } = await createClient().rpc("update_version", {
        p_version_id: version.id,
        p_name: version.name,
        p_description: version.description || undefined,
        p_released_at: version.released_at ? new Date(version.released_at).toISOString() : undefined,
        p_is_released: version.is_released,
        p_is_archived: !version.is_archived,
      });
      if (error) {
        toast.error("Could not update version archive status.");
        return;
      }
      setVersions((prev) =>
        prev.map((v) => (v.id === version.id ? { ...v, is_archived: !v.is_archived } : v)),
      );
      toast.success(version.is_archived ? "Version restored." : "Version archived.");
    } catch {
      toast.error("Could not reach the server.");
    }
  }
  // Milestone Actions
  function openAddMilestone() {
    setEditingMilestone(null);
    milestoneForm.reset({ name: "", description: "", due_at: "", status: "ACTIVE" });
    setMilestoneModalOpen(true);
  }

  function openEditMilestone(milestone: MilestoneRow) {
    setEditingMilestone(milestone);
    const validStatus = MILESTONE_STATUSES.find((s) => s === milestone.status) ?? "ACTIVE";
    milestoneForm.reset({
      name: milestone.name,
      description: milestone.description ?? "",
      due_at: milestone.due_at ? milestone.due_at.split("T")[0] : "",
      status: validStatus,
    });
    setMilestoneModalOpen(true);
  }

  async function saveMilestone(values: MilestoneValues) {
    if (editingMilestone) {
      try {
        const { error } = await createClient().rpc("update_milestone", {
          p_milestone_id: editingMilestone.id,
          p_name: values.name.trim(),
          p_description: values.description ? values.description.trim() : undefined,
          p_due_at: values.due_at ? new Date(values.due_at).toISOString() : undefined,
          p_status: values.status,
        });
        if (error) {
          toast.error("Could not update milestone.");
          return;
        }
        setMilestones((prev) => prev.map((m) => (m.id === editingMilestone.id ? { ...m, name: values.name.trim(), description: values.description ? values.description.trim() : null, due_at: values.due_at || null, status: values.status } : m)));
        toast.success("Milestone updated.");
      } catch {
        toast.error("Could not reach the server.");
      }
    } else {
      try {
        const { data, error } = await createClient().rpc("create_milestone", {
          p_project_id: projectId,
          p_name: values.name.trim(),
          p_description: values.description ? values.description.trim() : undefined,
          p_due_at: values.due_at ? new Date(values.due_at).toISOString() : undefined,
          p_status: values.status,
        });
        if (error) {
          toast.error("Could not create milestone.");
          return;
        }
        const newM: MilestoneRow = { id: String(data), name: values.name.trim(), description: values.description ? values.description.trim() : null, due_at: values.due_at || null, status: values.status };
        setMilestones((prev) => [...prev, newM]);
        toast.success("Milestone created.");
      } catch {
        toast.error("Could not reach the server.");
      }
    }
    setMilestoneModalOpen(false);
    setEditingMilestone(null);
  }

  const stateName = (id: string) => states.find((state) => state.id === id)?.name ?? "?";
  const settingTabs = [
    { value: "components" as const, label: "Components", icon: Layers3, count: components.length },
    { value: "labels" as const, label: "Labels", icon: Tag, count: labels.length },
    { value: "versions" as const, label: "Versions", icon: Calendar, count: versions.length },
    { value: "milestones" as const, label: "Milestones", icon: Milestone, count: milestones.length },
    { value: "workflow" as const, label: "Workflow", icon: GitBranch, count: states.length },
  ];

  return (
    <div className="space-y-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary">Project settings</p>
          <h1 className="text-3xl font-semibold tracking-tight"><span className="font-mono text-primary">{project.key}</span> · {project.name}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{project.description ?? "Components, planning metadata, and workflow for this project."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 text-xs"><Link href="/dashboard/settings/templates">Issue templates</Link></Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs"><Link href="/dashboard/settings/custom-fields">Custom fields & API</Link></Button>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs"><Link href="/dashboard/settings/integrations">Integrations</Link></Button>
        </div>
      </div>

      <div role="tablist" aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-border/80">
        {settingTabs.map(({ value, label, icon: Icon, count }) => (
          <button key={value} id={`tab-${value}`} aria-controls={`panel-${value}`} onClick={() => setTab(value)} role="tab" aria-selected={tab === value} className={cn("-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium", tab === value ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
            <span className="font-mono text-[10px] text-muted-foreground/70">{count}</span>
          </button>
        ))}
      </div>

      {/* Components Tab */}
      {tab === "components" && (
        <div role="tabpanel" id="panel-components" aria-labelledby="tab-components">
          <Surface>
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Components</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Group issues by functional area with default assignees.</p>
              </div>
              {canManage && (
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAddComp}><Plus className="h-3.5 w-3.5" /> Add component</Button>
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
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => openEditComp(component)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => toggleArchiveComp(component)} disabled={compBusyId === component.id}>
                          {compBusyId === component.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
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
      )}

      {/* Labels Tab */}
      {tab === "labels" && (
        <div role="tabpanel" id="panel-labels" aria-labelledby="tab-labels">
          <Surface>
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Labels</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Tags for categorizing and filtering issues.</p>
              </div>
              {canManage && (
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAddLabel}><Plus className="h-3.5 w-3.5" /> Add label</Button>
              )}
            </div>
            {labels.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No labels yet.</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {labels.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-full border border-black/20" style={{ backgroundColor: safeColor(l.color) }} />
                      <div>
                        <span className="font-mono text-xs font-semibold">{l.name}</span>
                        {l.description && <p className="text-xs text-muted-foreground">{l.description}</p>}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => openEditLabel(l)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => deleteLabel(l.id)}>
                          <Trash2 className="h-3 w-3" /> Delete
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
      )}

      {/* Versions Tab */}
      {tab === "versions" && (
        <div role="tabpanel" id="panel-versions" aria-labelledby="tab-versions">
          <Surface>
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Versions</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Target software releases and affected version milestones.</p>
              </div>
              {canManage && (
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={openAddVersion}>
                  <Plus className="h-3.5 w-3.5" /> Add Version
                </Button>
              )}
            </div>
            {versions.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No versions defined.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {versions.map((v) => (
                  <li key={v.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", v.is_archived && "opacity-55")}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{v.name}</span>
                        {v.is_released && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-emerald-400">released</span>}
                        {v.is_archived && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">archived</span>}
                      </div>
                      {v.description && <p className="text-xs text-muted-foreground">{v.description}</p>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => openEditVersion(v)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => void toggleArchiveVersion(v)}>
                          <Archive className="h-3 w-3" /> {v.is_archived ? "Restore" : "Archive"}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
      )}

      {/* Milestones Tab */}
      {tab === "milestones" && (
        <div role="tabpanel" id="panel-milestones" aria-labelledby="tab-milestones">
          <Surface>
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Milestones</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Target sprint or release checkpoints with completion metrics.</p>
              </div>
              {canManage && (
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openAddMilestone}><Plus className="h-3.5 w-3.5" /> Add milestone</Button>
              )}
            </div>
            {milestones.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No milestones planned yet.</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {milestones.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/milestones/${m.id}`} className="font-medium text-primary hover:underline flex items-center gap-1.5 text-sm">
                          <Milestone className="h-3.5 w-3.5" /> {m.name}
                        </Link>
                        <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide", m.status === "ACTIVE" ? "border-blue-500/30 bg-blue-500/10 text-blue-400" : m.status === "COMPLETED" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-zinc-500/30 bg-zinc-500/10 text-zinc-400")}>{m.status}</span>
                      </div>
                      {m.due_at && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Calendar className="h-3 w-3" /> Due {new Date(m.due_at).toLocaleDateString()}</p>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <Button asChild variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                          <Link href={`/dashboard/milestones/${m.id}`}>View metrics <ExternalLink className="ml-1 h-3 w-3" /></Link>
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => openEditMilestone(m)}>
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
      )}

      {/* Workflow Tab */}
      {tab === "workflow" && (
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

      {/* Component Dialog */}
      <Dialog open={compAddOpen} onOpenChange={setCompAddOpen}>
        <DialogContent className="max-w-md rounded-[10px]">
          <DialogHeader>
            <DialogTitle className="text-base">{editingComp ? "Edit component" : "New component"}</DialogTitle>
            <DialogDescription>Component names are unique within the project.</DialogDescription>
          </DialogHeader>
          <form onSubmit={compForm.handleSubmit(saveComponent)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="component-name">Name</Label>
              <Input id="component-name" placeholder="component name" {...compForm.register("name")} />
              {compForm.formState.errors.name && <p className="text-xs text-destructive">{compForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="component-description">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="component-description" placeholder="component scope or description" {...compForm.register("description")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="component-assignee">Default assignee</Label>
              <select id="component-assignee" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" {...compForm.register("default_assignee_id")}>
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>{member.displayName ?? member.userId.slice(0, 8)}</option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={compForm.formState.isSubmitting}>
                {compForm.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingComp ? "Save changes" : "Create component"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Label Dialog */}
      <Dialog open={labelModalOpen} onOpenChange={setLabelModalOpen}>
        <DialogContent className="max-w-md rounded-[10px]">
          <DialogHeader>
            <DialogTitle className="text-base">{editingLabel ? "Edit label" : "New label"}</DialogTitle>
            <DialogDescription>Labels help categorize and filter issues.</DialogDescription>
          </DialogHeader>
          <form onSubmit={labelForm.handleSubmit(saveLabel)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="label-name">Name</Label>
              <Input id="label-name" placeholder="label name" {...labelForm.register("name")} />
              {labelForm.formState.errors.name && <p className="text-xs text-destructive">{labelForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="label-color">Color</Label>
              <div className="flex items-center gap-2">
                <input id="label-color-picker" type="color" aria-label="Label color picker" className="h-9 w-12 cursor-pointer rounded border border-input bg-background p-1" {...labelForm.register("color")} />
                <Input id="label-color" placeholder="#hex" aria-label="Label hex color" {...labelForm.register("color")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="label-description">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="label-description" placeholder="label purpose or usage" {...labelForm.register("description")} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={labelForm.formState.isSubmitting}>
                {labelForm.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingLabel ? "Save changes" : "Create label"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Version Dialog */}
      <Dialog open={versionModalOpen} onOpenChange={setVersionModalOpen}>
        <DialogContent className="max-w-md rounded-[10px]">
          <DialogHeader>
            <DialogTitle className="text-base">{editingVersion ? "Edit version" : "New version"}</DialogTitle>
            <DialogDescription>Track affected software releases and release checkpoints.</DialogDescription>
          </DialogHeader>
          <form onSubmit={versionForm.handleSubmit(saveVersion)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="version-name">Version name</Label>
              <Input id="version-name" placeholder="version name (e.g. v1.0)" {...versionForm.register("name")} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" {...versionForm.register("is_released")} />
              Mark version as released
            </label>
              {versionForm.formState.errors.name && <p className="text-xs text-destructive">{versionForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-released">Release date <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="version-released" type="date" {...versionForm.register("released_at")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="version-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="version-desc" placeholder="version release notes or scope" {...versionForm.register("description")} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={versionForm.formState.isSubmitting}>
                {versionForm.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingVersion ? "Save changes" : "Create version"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Milestone Dialog */}
      <Dialog open={milestoneModalOpen} onOpenChange={setMilestoneModalOpen}>
        <DialogContent className="max-w-md rounded-[10px]">
          <DialogHeader>
            <DialogTitle className="text-base">{editingMilestone ? "Edit milestone" : "New milestone"}</DialogTitle>
            <DialogDescription>Target checkpoints with progress and completion tracking.</DialogDescription>
          </DialogHeader>
          <form onSubmit={milestoneForm.handleSubmit(saveMilestone)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="milestone-name">Milestone title</Label>
              <Input id="milestone-name" placeholder="milestone title" {...milestoneForm.register("name")} />
              {milestoneForm.formState.errors.name && <p className="text-xs text-destructive">{milestoneForm.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="milestone-due">Due date <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="milestone-due" type="date" {...milestoneForm.register("due_at")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="milestone-status">Status</Label>
              <select id="milestone-status" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" {...milestoneForm.register("status")}>
                {MILESTONE_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="milestone-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="milestone-desc" placeholder="milestone goals or deliverables" {...milestoneForm.register("description")} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={milestoneForm.formState.isSubmitting}>
                {milestoneForm.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingMilestone ? "Save changes" : "Create milestone"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
