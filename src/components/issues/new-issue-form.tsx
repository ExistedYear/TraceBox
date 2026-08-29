"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useForm, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { formatIssueKey, ISSUE_TYPES, PRIORITIES, SEVERITIES } from "@/lib/issues";
import { cn } from "@/lib/utils";
import { issueCreateSchema, type IssueCreateValues } from "@/lib/validation/issue";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import type { Json } from "@/types/database";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const errorClass = "text-xs text-destructive";

export type IssueTemplateItem = {
  id: string;
  name: string;
  description: string | null;
  issue_type: string;
  body_template: string;
  default_priority: string | null;
  default_severity: string | null;
  default_component_id: string | null;
};
export type RequiredCustomField = { id: string; name: string; field_type: string; config: Record<string, unknown>; is_required: boolean };

export function NewIssueForm({
  projectId,
  projectKey,
  components,
  members,
  templates = [],
  requiredCustomFields = [],
  initialStateName,
}: {
  projectId: string;
  projectKey: string;
  components: { id: string; name: string; defaultAssigneeId: string | null }[];
  members: { userId: string; displayName: string | null }[];
  templates?: IssueTemplateItem[];
  requiredCustomFields?: RequiredCustomField[];
  initialStateName: string;
}) {
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = useState(requiredCustomFields.length > 0);
  const [duplicateCandidates, setDuplicateCandidates] = useState<Array<{ issue_number: number; title: string }>>([]);
  const [duplicateSearchError, setDuplicateSearchError] = useState(false);
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
      visibility: "PROJECT",
      access_user_ids: [],
      template_id: "",
      custom_values: {},
    },
  });
  const componentField = form.register("component_id");
  const watchedTitle = form.watch("title");
  const duplicateSeq = useRef(0);

  useUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitting, "Discard this unsaved issue?");

  useEffect(() => {
    const title = watchedTitle?.trim();
    if (!title || title.length < 6) {
      setDuplicateCandidates([]);
      setDuplicateSearchError(false);
      return;
    }
    const seq = ++duplicateSeq.current;
    const handle = setTimeout(async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("find_duplicate_candidates", { p_project_id: projectId, p_title: title, p_limit: 5 });
        if (seq !== duplicateSeq.current) return;
        if (error) throw error;
        setDuplicateSearchError(false);
        setDuplicateCandidates((data ?? []).map((candidate) => ({ issue_number: Number(candidate.issue_number), title: candidate.title })));
      } catch {
        if (seq === duplicateSeq.current) {
          setDuplicateCandidates([]);
          setDuplicateSearchError(true);
        }
      }
    }, 450);
    return () => {
      clearTimeout(handle);
      if (duplicateSeq.current === seq) duplicateSeq.current += 1;
    };
  }, [watchedTitle, projectId]);
  function applyTemplate(templateId: string) {
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    form.setValue("template_id", templateId);
    if (tmpl.body_template) form.setValue("description", tmpl.body_template, { shouldValidate: true });
    if ((ISSUE_TYPES as readonly string[]).includes(tmpl.issue_type)) form.setValue("type", tmpl.issue_type as IssueCreateValues["type"], { shouldValidate: true });
    if (tmpl.default_priority && (PRIORITIES as readonly string[]).includes(tmpl.default_priority)) form.setValue("priority", tmpl.default_priority as IssueCreateValues["priority"]);
    if (tmpl.default_severity && (SEVERITIES as readonly string[]).includes(tmpl.default_severity)) form.setValue("severity", tmpl.default_severity as IssueCreateValues["severity"]);
    if (tmpl.default_component_id) form.setValue("component_id", tmpl.default_component_id);
    toast.info(`Applied template "${tmpl.name}"`);
  }


  async function onSubmit(values: IssueCreateValues) {
    const customValues = { ...(values.custom_values ?? {}) } as Record<string, unknown>;
    for (const field of requiredCustomFields) {
      const raw = customValues[field.id];
      if (field.field_type === "NUMBER" && typeof raw === "string") customValues[field.id] = raw === "" ? null : Number(raw);
      if (field.field_type === "BOOLEAN" && typeof raw === "string") customValues[field.id] = raw === "" ? null : raw === "true";
      if (field.field_type === "DATE" && raw === "") customValues[field.id] = null;
    }
    let issueNumber;
    try {
      issueNumber = await createClient().rpc("create_issue_complete", {
        p_project_id: projectId,
        p_payload: {
          ...values,
          custom_values: customValues,
          title: values.title.trim(),
          description: values.description?.trim() ?? "",
          component_id: values.component_id || null,
          assignee_id: values.assignee_id || null,
          template_id: values.template_id || null,
        } as unknown as Json,
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
                : message.includes("Required custom field")
                  ? "Complete every required custom field."
                  : message.includes("VALIDATION")
                    ? "Check the issue fields and try again."
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
      {templates.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-card/40 p-2.5">
          <span className="font-mono text-xs text-muted-foreground">Load issue template:</span>
          <select
            aria-label="Load issue template"
            className="h-8 max-w-xs rounded-md border border-input bg-background px-2 text-xs"
            onChange={(e) => applyTemplate(e.target.value)}
            defaultValue=""
          >
            <option value="" disabled>Choose a template...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.issue_type})</option>
            ))}
          </select>
        </div>
      )}
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
                    rel="noreferrer"
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
        {duplicateSearchError ? <p role="status" className="text-xs text-muted-foreground">Duplicate suggestions are temporarily unavailable. You can still create this issue.</p> : null}
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
          <div className="space-y-3 border-t border-border/70 pt-3">
            <div className="space-y-2"><Label htmlFor="issue-visibility">Visibility</Label><select id="issue-visibility" className={selectClass} {...form.register("visibility")}><option value="PROJECT">Project members</option><option value="RESTRICTED">Restricted security issue</option></select><p className="text-[11px] text-muted-foreground">Restricted issues are visible only to maintainers, the reporter, the assignee, and explicitly granted project members.</p></div>
            {form.watch("visibility") === "RESTRICTED" && <div className="space-y-2"><Label htmlFor="issue-access-users">Initial access grants</Label><select id="issue-access-users" multiple className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-xs" {...form.register("access_user_ids")}><option disabled value="">Select project members…</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}</select><p className="text-[11px] text-muted-foreground">Hold Ctrl/Cmd to select additional reviewers.</p></div>}
            {requiredCustomFields.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{requiredCustomFields.map((field) => <CustomFieldInput key={field.id} field={field} members={members} register={form.register} />)}</div>}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => { if (!form.formState.isDirty || window.confirm("Discard this unsaved issue?")) router.back(); }}>Cancel</Button>
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

function CustomFieldInput({ field, members, register }: { field: RequiredCustomField; members: Array<{ userId: string; displayName: string | null }>; register: UseFormRegister<IssueCreateValues> }) {
  const name = `custom_values.${field.id}` as `custom_values.${string}`;
  const options = Array.isArray(field.config.options) ? field.config.options.filter((item): item is string => typeof item === "string") : [];
  const control = field.field_type === "SINGLE_SELECT" ? <select id={`issue-custom-${field.id}`} className={selectClass} {...register(name)}><option value="">Select…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
    : field.field_type === "MULTI_SELECT" ? <select id={`issue-custom-${field.id}`} multiple className="min-h-20 w-full rounded-md border border-input bg-background px-2 py-1 text-xs" {...register(name)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      : field.field_type === "BOOLEAN" ? <select id={`issue-custom-${field.id}`} className={selectClass} {...register(name)}><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></select>
        : field.field_type === "USER" ? <select id={`issue-custom-${field.id}`} className={selectClass} {...register(name)}><option value="">Select…</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName ?? member.userId.slice(0, 8)}</option>)}</select>
          : <Input id={`issue-custom-${field.id}`} type={field.field_type === "NUMBER" ? "number" : field.field_type === "DATE" ? "date" : "text"} {...register(name)} />;
  return <div className="space-y-2"><Label htmlFor={`issue-custom-${field.id}`}>{field.name} {field.is_required && <span className="text-destructive">*</span>}</Label>{control}</div>;
}
