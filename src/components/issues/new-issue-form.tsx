"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { formatIssueKey, ISSUE_TYPES, PRIORITIES, SEVERITIES } from "@/lib/issues";
import { cn } from "@/lib/utils";
import { issueCreateSchema, type IssueCreateValues } from "@/lib/validation/issue";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const errorClass = "text-xs text-destructive";

export function NewIssueForm({
  projectId,
  projectKey,
  components,
  members,
  initialStateName,
}: {
  projectId: string;
  projectKey: string;
  components: { id: string; name: string; defaultAssigneeId: string | null }[];
  members: { userId: string; displayName: string | null }[];
  initialStateName: string;
}) {
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<Array<{ issue_number: number; title: string }>>([]);
  const form = useForm<IssueCreateValues>({
    resolver: zodResolver(issueCreateSchema),
    defaultValues: {
      title: "",
      description: "",
      type: "BUG",
      component_id: "",
      priority: "P2",
      severity: "MAJOR",
      assignee_id: "",
      environment: "",
      steps_to_reproduce: "",
      expected_behavior: "",
      actual_behavior: "",
    },
  });
  const componentField = form.register("component_id");
  const watchedTitle = form.watch("title");
  const duplicateSeq = useRef(0);

  useEffect(() => {
    const title = watchedTitle?.trim();
    if (!title || title.length < 6) {
      setDuplicateCandidates([]);
      return;
    }
    const seq = ++duplicateSeq.current;
    const handle = setTimeout(async () => {
      const supabase = createClient();
      function escapeIlike(s: string): string {
        return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      }
      const safe = title.split(/\s+/).slice(0, 3).map(escapeIlike).join("%");
      const { data } = await supabase
        .from("issues")
        .select("issue_number, title")
        .eq("project_id", projectId)
        .ilike("title", `%${safe}%`)
        .limit(5);
      if (seq !== duplicateSeq.current) return;
      if (data) setDuplicateCandidates(data as any);
    }, 450);
    return () => clearTimeout(handle);
  }, [watchedTitle, projectId]);

  async function onSubmit(values: IssueCreateValues) {
    let issueNumber: { data: number | null; error: { message: string } | null };
    try {
      issueNumber = await createClient().rpc("create_issue", {
        p_project_id: projectId,
        p_title: values.title.trim(),
        p_type: values.type,
        p_description: values.description ? values.description.trim() : undefined,
        p_component_id: values.component_id || undefined,
        p_priority: values.priority,
        p_severity: values.severity,
        p_assignee_id: values.assignee_id || undefined,
        p_environment: values.environment ? values.environment.trim() : undefined,
        p_steps_to_reproduce: values.steps_to_reproduce ? values.steps_to_reproduce.trim() : undefined,
        p_expected_behavior: values.expected_behavior ? values.expected_behavior.trim() : undefined,
        p_actual_behavior: values.actual_behavior ? values.actual_behavior.trim() : undefined,
      });
    } catch (err) {
      console.error("Unexpected issue creation error:", err);
      toast.error("Could not reach the server. Please try again.");
      return;
    }
    if (issueNumber.error) {
      console.error("Issue creation failed:", issueNumber.error);
      const message = String(issueNumber.error.message);
      toast.error(
        message.includes("NOT_ALLOWED")
          ? "Viewers cannot file issues in this project."
          : message.includes("PROJECT_ARCHIVED")
            ? "This project is archived."
            : message.includes("INVALID_COMPONENT")
              ? "That component is not available."
              : message.includes("INVALID_ASSIGNEE")
                ? "That assignee is not eligible for this project."
                : "Could not create the issue.",
      );
      return;
    }
    toast.success(`Issue ${formatIssueKey(projectKey, Number(issueNumber.data))} created.`);
    router.push(`/dashboard/issues/${formatIssueKey(projectKey, Number(issueNumber.data))}`);
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="issue-title">Title</Label>
        <Input id="issue-title" placeholder="summary of the issue" {...form.register("title")} />
        {form.formState.errors.title && <p className={errorClass}>{form.formState.errors.title.message}</p>}
        {duplicateCandidates.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2">
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Possible duplicates:</p>
            <ul className="mt-1 space-y-1">
              {duplicateCandidates.map((c) => (
                <li key={c.issue_number} className="text-xs text-muted-foreground">
                  <Link
                    href={`/dashboard/issues/${formatIssueKey(projectKey, c.issue_number)}`}
                    target="_blank"
                    className="font-mono text-primary hover:underline"
                  >
                    {formatIssueKey(projectKey, c.issue_number)}
                  </Link>{" "}
                  · {c.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="issue-type">Type</Label>
          <select id="issue-type" className={selectClass} {...form.register("type")}>
            {ISSUE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="issue-component">Component</Label>
          <select id="issue-component" className={selectClass} {...componentField} onChange={(event) => { componentField.onChange(event); const selected = components.find((component) => component.id === event.target.value); if (selected?.defaultAssigneeId && !form.getValues("assignee_id")) form.setValue("assignee_id", selected.defaultAssigneeId); }}>
            <option value="">None</option>
            {components.map((component) => (
              <option key={component.id} value={component.id}>{component.name}</option>
            ))}
          </select>
          {form.formState.errors.component_id && <p className="text-xs text-destructive">{form.formState.errors.component_id.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="issue-status-hint">Status</Label>
          <Input id="issue-status-hint" value={initialStateName} disabled />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="issue-description">Description</Label>
        <textarea id="issue-description" rows={6} placeholder="details, reproduction steps, or expected behavior" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register("description")} />
        {form.formState.errors.description && <p className={errorClass}>{form.formState.errors.description.message}</p>}
      </div>

      <button type="button" onClick={() => setShowAdvanced((value) => !value)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={showAdvanced}>
        {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Advanced fields
      </button>

      {showAdvanced && (
        <div className="space-y-4 rounded-[10px] border border-border/80 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="issue-priority">Priority</Label>
              <select id="issue-priority" className={selectClass} {...form.register("priority")}>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issue-severity">Severity</Label>
              <select id="issue-severity" className={selectClass} {...form.register("severity")}>
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>{severity}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issue-assignee">Assignee</Label>
              <select id="issue-assignee" className={selectClass} {...form.register("assignee_id")}>
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>{member.displayName ?? member.userId.slice(0, 8)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Environment" id="issue-environment" placeholder="browser, OS, or runtime version" register={form.register("environment")} error={form.formState.errors.environment?.message} />
            <Field label="Steps to reproduce" id="issue-steps" placeholder="1. step one, 2. step two" register={form.register("steps_to_reproduce")} error={form.formState.errors.steps_to_reproduce?.message} />
            <Field label="Expected behaviour" id="issue-expected" placeholder="what should happen" register={form.register("expected_behavior")} error={form.formState.errors.expected_behavior?.message} />
            <Field label="Actual behaviour" id="issue-actual" placeholder="what actually happened" register={form.register("actual_behavior")} error={form.formState.errors.actual_behavior?.message} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={form.formState.isSubmitting} className={cn(form.formState.isSubmitting && "opacity-80")}>
          {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create issue
        </Button>
      </div>
    </form>
  );
}

function Field({ label, id, placeholder, register, error }: { label: string; id: string; placeholder?: string; register: Record<string, unknown>; error?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea id={id} rows={2} placeholder={placeholder} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register} />
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}
