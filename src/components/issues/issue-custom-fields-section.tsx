"use client";

import { useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";

export type CustomField = { id: string; name: string; field_type: string; config: Record<string, unknown>; is_required: boolean };
export type CustomValue = { custom_field_id: string; value: unknown };
type Props = { issueId: string; fields: CustomField[]; initialValues: CustomValue[]; canEdit: boolean; members: Array<{ id: string; label: string }> };

function display(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value);
}

export function IssueCustomFieldsSection({ issueId, fields, initialValues, canEdit, members }: Props) {
  const [values, setValues] = useState(initialValues);
  const [savedValues, setSavedValues] = useState(initialValues);
  const [saving, setSaving] = useState<string | null>(null);

  if (!fields.length) return null;

  function currentValue(fieldId: string) {
    return values.find((item) => item.custom_field_id === fieldId)?.value;
  }

  function setLocal(fieldId: string, value: unknown) {
    setValues((items) => [...items.filter((item) => item.custom_field_id !== fieldId), { custom_field_id: fieldId, value }]);
  }

  function restoreSaved(fieldId: string, saved: CustomValue | undefined) {
    setValues((items) => {
      const withoutField = items.filter((item) => item.custom_field_id !== fieldId);
      return saved ? [...withoutField, saved] : withoutField;
    });
  }

  async function save(field: CustomField, value: unknown) {
    if (saving) return;
    const saved = savedValues.find((item) => item.custom_field_id === field.id);
    if (field.is_required && (value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0))) {
      restoreSaved(field.id, saved);
      toast.error(`${field.name} is required.`);
      return;
    }
    setSaving(field.id);
    try {
      const { error } = await createClient().rpc("set_issue_custom_value", { p_issue_id: issueId, p_custom_field_id: field.id, p_value: value as Json });
      if (error) { restoreSaved(field.id, saved); toast.error(`Could not save ${field.name}.`); return; }
      setSavedValues((items) => [...items.filter((item) => item.custom_field_id !== field.id), { custom_field_id: field.id, value }]);
      toast.success(`${field.name} saved.`);
    } catch { restoreSaved(field.id, saved); toast.error("Could not reach the server."); } finally { setSaving(null); }
  }

  function editor(field: CustomField) {
    const value = currentValue(field.id);
    const disabled = Boolean(saving);
    const options = Array.isArray(field.config.options) ? field.config.options.filter((item): item is string => typeof item === "string") : [];
    const className = "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs";
    if (field.field_type === "BOOLEAN") return <select id={`custom-${field.id}`} disabled={disabled} className={className} value={value === true ? "true" : value === false ? "false" : ""} onChange={(event) => { const next = event.target.value === "" ? null : event.target.value === "true"; setLocal(field.id, next); void save(field, next); }}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>;
    if (field.field_type === "SINGLE_SELECT") return <select id={`custom-${field.id}`} disabled={disabled} className={className} value={display(value)} onChange={(event) => { const next = event.target.value || null; setLocal(field.id, next); void save(field, next); }}><option value="">Select…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
    if (field.field_type === "MULTI_SELECT") return <select id={`custom-${field.id}`} disabled={disabled} multiple className="min-h-20 min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs" value={Array.isArray(value) ? value.map(String) : []} onChange={(event) => { const next = Array.from(event.target.selectedOptions, (option) => option.value); setLocal(field.id, next); void save(field, next); }}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
    if (field.field_type === "USER") return <select id={`custom-${field.id}`} disabled={disabled} className={className} value={display(value)} onChange={(event) => { const next = event.target.value || null; setLocal(field.id, next); void save(field, next); }}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select>;
    const inputType = field.field_type === "NUMBER" ? "number" : field.field_type === "DATE" ? "date" : "text";
    return <input id={`custom-${field.id}`} disabled={disabled} type={inputType} value={display(value)} onChange={(event) => setLocal(field.id, event.target.value)} onBlur={(event) => { const raw = event.target.value; const next = field.field_type === "NUMBER" ? raw === "" ? null : Number(raw) : raw || null; if (typeof next === "number" && !Number.isFinite(next)) { restoreSaved(field.id, savedValues.find((item) => item.custom_field_id === field.id)); toast.error(`${field.name} must be a valid number.`); return; } setLocal(field.id, next); void save(field, next); }} className={className} placeholder={field.field_type === "TEXT" ? `Enter ${field.name.toLowerCase()}` : undefined} />;
  }

  return <section className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4"><div className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" /><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom fields</h2></div><div className="grid gap-3 sm:grid-cols-2">{fields.map((field) => <div key={field.id} className="space-y-1"><label htmlFor={`custom-${field.id}`} className="text-xs text-muted-foreground">{field.name}{field.is_required ? " *" : ""}</label>{canEdit ? <div className="flex gap-2">{editor(field)}{saving === field.id && <Loader2 className="mt-2 h-3 w-3 animate-spin text-primary" />}</div> : <p className="text-xs font-medium">{display(currentValue(field.id)) || "—"}</p>}</div>)}</div></section>;
}
