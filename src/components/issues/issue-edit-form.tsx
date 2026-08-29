"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Eye, Pencil, RotateCcw } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { MarkdownContent } from "@/components/tracebox/markdown-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { ISSUE_TYPES, PRIORITIES, SEVERITIES } from "@/lib/issues";
import { issueUpdateSchema, type IssueUpdateValues } from "@/lib/validation/issue-update";
import { useRealtimeIssueUpdates } from "@/hooks/use-realtime";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const errorClass = "text-xs text-destructive";

export type IssueEditInitialValues = {
  title: string;
  description: string | null;
  environment: string | null;
  steps_to_reproduce: string | null;
  expected_behavior: string | null;
  actual_behavior: string | null;
  priority: string;
  severity: string;
  type: string;
  assignee_id: string | null;
  component_id: string | null;
};

type Props = {
  issueId: string;
  projectId: string;
  expectedUpdatedAt: string;
  initialValues: IssueEditInitialValues;
  components: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; displayName: string }>;
  canEdit: boolean;
};

function normalize(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function IssueEditForm({ issueId, projectId, expectedUpdatedAt, initialValues, components, members, canEdit }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const loadedUpdatedAt = useRef(expectedUpdatedAt);
  const form = useForm<IssueUpdateValues>({
    resolver: zodResolver(issueUpdateSchema),
    defaultValues: {
      title: initialValues.title,
      description: initialValues.description ?? "",
      environment: initialValues.environment ?? "",
      steps_to_reproduce: initialValues.steps_to_reproduce ?? "",
      expected_behavior: initialValues.expected_behavior ?? "",
      actual_behavior: initialValues.actual_behavior ?? "",
      priority: initialValues.priority as IssueUpdateValues["priority"],
      severity: initialValues.severity as IssueUpdateValues["severity"],
      type: initialValues.type as IssueUpdateValues["type"],
      assignee_id: initialValues.assignee_id ?? "",
      component_id: initialValues.component_id ?? "",
    },
  });
  const body = form.watch("description") ?? "";
  const dirty = form.formState.isDirty;

  useRealtimeIssueUpdates(
    projectId,
    (payload) => {
      if (!payload || typeof payload !== "object" || (payload as { id?: unknown }).id !== issueId) return;
      if (open && dirty) {
        setExternalChange(true);
        return;
      }
      router.refresh();
    },
    (payload) => {
      if (payload && typeof payload === "object" && (payload as { id?: unknown }).id === issueId) router.replace("/dashboard/issues");
    },
    () => toast.error("Live issue updates disconnected. Reload to verify the latest version."),
    () => {
      if (open && dirty) setExternalChange(true);
      else router.refresh();
    },
    canEdit,
  );


  useUnsavedChanges(open && dirty && !form.formState.isSubmitting, "Discard your unsaved issue changes?");

  const initialState = useMemo(() => ({
    title: initialValues.title,
    description: initialValues.description ?? "",
    environment: initialValues.environment ?? "",
    steps_to_reproduce: initialValues.steps_to_reproduce ?? "",
    expected_behavior: initialValues.expected_behavior ?? "",
    actual_behavior: initialValues.actual_behavior ?? "",
    priority: initialValues.priority,
    severity: initialValues.severity,
    type: initialValues.type,
    assignee_id: initialValues.assignee_id ?? "",
    component_id: initialValues.component_id ?? "",
  }), [initialValues]);

  useEffect(() => {
    if (open) return;
    form.reset(initialState as IssueUpdateValues);
    loadedUpdatedAt.current = expectedUpdatedAt;
  }, [expectedUpdatedAt, form, initialState, open]);

  function closeEditor() {
    if (dirty && !window.confirm("Discard your unsaved issue changes?")) return;
    form.reset(initialState as IssueUpdateValues);
    loadedUpdatedAt.current = expectedUpdatedAt;
    setPreview(false);
    setExternalChange(false);
    setOpen(false);
  }

  async function submit(values: IssueUpdateValues) {
    const updates: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      updates[key] = typeof value === "string" ? normalize(value) : value as string | null;
    }
    try {
      const { error } = await createClient().rpc("update_issue_fields", {
        p_issue_id: issueId,
        p_updates: updates,
        p_expected_updated_at: loadedUpdatedAt.current,
      });
      if (error) {
        console.error("Issue edit failed:", error);
        const message = String(error.message);
        if (message.includes("CONFLICT")) toast.error("This issue changed elsewhere. Reload before saving your edits.");
        else if (message.includes("NOT_ALLOWED")) toast.error("You do not have permission to edit this issue.");
        else if (message.includes("PROJECT_ARCHIVED")) toast.error("This project is archived.");
        else toast.error("Could not save issue changes.");
        return;
      }
      toast.success("Issue updated.");
      setExternalChange(false);
      setOpen(false);
      router.refresh();
    } catch (error) {
      console.error("Unexpected issue edit error:", error);
      toast.error("Could not reach the server. Please try again.");
    }
  }

  if (!canEdit) return null;
  if (!open) return <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => { loadedUpdatedAt.current = expectedUpdatedAt; setOpen(true); }}><Pencil className="h-3.5 w-3.5" /> Edit issue</Button>;

  return (
      <section className="rounded-[10px] border border-primary/30 bg-card/50 p-4" aria-label="Edit issue">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Edit issue</h2><p className="mt-1 text-xs text-muted-foreground">Changes are recorded in the activity timeline.</p></div>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => setPreview((value) => !value)}><Eye className="h-3.5 w-3.5" /> {preview ? "Edit markdown" : "Preview markdown"}</Button>
      </div>
      {externalChange && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />This issue changed elsewhere. Your draft was preserved and has not been overwritten.</span><Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.location.reload()}>Reload latest</Button></div>}
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="edit-issue-title">Title</Label><Input id="edit-issue-title" {...form.register("title")} />{form.formState.errors.title && <p className={errorClass}>{form.formState.errors.title.message}</p>}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2"><Label htmlFor="edit-issue-type">Type</Label><select id="edit-issue-type" className={selectClass} {...form.register("type")}>{ISSUE_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="edit-issue-priority">Priority</Label><select id="edit-issue-priority" className={selectClass} {...form.register("priority")}>{PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="edit-issue-severity">Severity</Label><select id="edit-issue-severity" className={selectClass} {...form.register("severity")}>{SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="edit-issue-component">Component</Label><select id="edit-issue-component" className={selectClass} {...form.register("component_id")}><option value="">None</option>{components.map((component) => <option key={component.id} value={component.id}>{component.name}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="edit-issue-assignee">Assignee</Label><select id="edit-issue-assignee" className={selectClass} {...form.register("assignee_id")}><option value="">Unassigned</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select></div>
        </div>
        <BodyField id="edit-issue-description" label="Description" register={form.register("description")} value={body} preview={preview} error={form.formState.errors.description?.message} />
        <div className="grid gap-3 sm:grid-cols-2">
          <BodyField id="edit-issue-environment" label="Environment" register={form.register("environment")} value={form.watch("environment") ?? ""} preview={false} error={form.formState.errors.environment?.message} />
          <BodyField id="edit-issue-steps" label="Steps to reproduce" register={form.register("steps_to_reproduce")} value={form.watch("steps_to_reproduce") ?? ""} preview={false} error={form.formState.errors.steps_to_reproduce?.message} />
          <BodyField id="edit-issue-expected" label="Expected behaviour" register={form.register("expected_behavior")} value={form.watch("expected_behavior") ?? ""} preview={false} error={form.formState.errors.expected_behavior?.message} />
          <BodyField id="edit-issue-actual" label="Actual behaviour" register={form.register("actual_behavior")} value={form.watch("actual_behavior") ?? ""} preview={false} error={form.formState.errors.actual_behavior?.message} />
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={closeEditor}><RotateCcw className="h-3.5 w-3.5" /> Cancel</Button><Button type="submit" size="sm" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save changes</Button></div>
      </form>
    </section>
  );
}

function BodyField({ id, label, register, value, preview, error }: { id: string; label: string; register: ReturnType<ReturnType<typeof useForm<IssueUpdateValues>>["register"]>; value: string; preview: boolean; error?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{preview ? <div className="min-h-32 rounded-md border border-input bg-background/60 px-3 py-2"><MarkdownContent body={value || "Nothing written yet."} /></div> : <textarea id={id} rows={id.includes("description") ? 7 : 3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register} />}{error && <p className={errorClass}>{error}</p>}</div>;
}
