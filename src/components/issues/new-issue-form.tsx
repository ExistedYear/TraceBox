"use client";

import { useState } from "react";
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
  components: { id: string; name: string }[];
  members: { userId: string; displayName: string | null }[];
  initialStateName: string;
}) {
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  async function onSubmit(values: IssueCreateValues) {
    const issueNumber = await createClient().rpc("create_issue", {
      p_project_id: projectId,
      p_title: values.title,
      p_type: values.type,
      p_description: values.description || undefined,
      p_component_id: values.component_id || undefined,
      p_priority: values.priority,
      p_severity: values.severity,
      p_assignee_id: values.assignee_id || undefined,
      p_environment: values.environment || undefined,
      p_steps_to_reproduce: values.steps_to_reproduce || undefined,
      p_expected_behavior: values.expected_behavior || undefined,
      p_actual_behavior: values.actual_behavior || undefined,
    });
    if (typeof issueNumber.error === "object" && issueNumber.error) {
      const message = String(issueNumber.error.message);
      toast.error(
        message.includes("NOT_ALLOWED")
          ? "Viewers cannot file issues in this project."
          : message.includes("INVALID_COMPONENT")
            ? "That component is not available."
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
        <Input id="issue-title" placeholder="Short, specific summary" {...form.register("title")} />
        {form.formState.errors.title && <p className={errorClass}>{form.formState.errors.title.message}</p>}
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
          <select id="issue-component" className={selectClass} {...form.register("component_id")}>
            <option value="">None</option>
            {components.map((component) => (
              <option key={component.id} value={component.id}>{component.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="issue-status-hint">Status</Label>
          <Input id="issue-status-hint" value={initialStateName} disabled />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="issue-description">Description</Label>
        <textarea id="issue-description" rows={6} placeholder="What happened? What should happen instead?" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...form.register("description")} />
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
            <Field label="Environment" id="issue-environment" register={form.register("environment")} error={form.formState.errors.environment?.message} />
            <Field label="Steps to reproduce" id="issue-steps" register={form.register("steps_to_reproduce")} error={form.formState.errors.steps_to_reproduce?.message} />
            <Field label="Expected behaviour" id="issue-expected" register={form.register("expected_behavior")} error={form.formState.errors.expected_behavior?.message} />
            <Field label="Actual behaviour" id="issue-actual" register={form.register("actual_behavior")} error={form.formState.errors.actual_behavior?.message} />
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

function Field({ label, id, register, error }: { label: string; id: string; register: Record<string, unknown>; error?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea id={id} rows={2} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...register} />
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}
