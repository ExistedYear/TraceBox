"use client";

import { useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";

export type CustomField = { id: string; name: string; field_type: string; config: Record<string, unknown>; is_required: boolean };
export type CustomValue = { custom_field_id: string; value: unknown };
type Props = { issueId: string; fields: CustomField[]; initialValues: CustomValue[]; canEdit: boolean };

export function IssueCustomFieldsSection({ issueId, fields, initialValues, canEdit }: Props) {
  const [values, setValues] = useState(initialValues);
  const [saving, setSaving] = useState<string | null>(null);
  if (!fields.length) return null;

  async function save(field: CustomField, raw: string) {
    let value: unknown = raw;
    if (field.field_type === "NUMBER") value = raw === "" ? null : Number(raw);
    if (field.field_type === "BOOLEAN") value = raw === "true";
    if (field.field_type === "MULTI_SELECT") value = raw.split(",").map((item) => item.trim()).filter(Boolean);
    setSaving(field.id);
    try {
      const { error } = await createClient().rpc("set_issue_custom_value", { p_issue_id: issueId, p_custom_field_id: field.id, p_value: value as any });
      if (error) { toast.error("Could not save custom field."); return; }
      setValues((current) => [...current.filter((item) => item.custom_field_id !== field.id), { custom_field_id: field.id, value }]);
      toast.success("Custom field saved.");
    } catch { toast.error("Could not reach the server."); } finally { setSaving(null); }
  }

  function display(value: unknown) { return Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value); }
  return <section className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-4"><div className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" /><h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom fields</h2></div><div className="grid gap-3 sm:grid-cols-2">{fields.map((field) => { const current = values.find((item) => item.custom_field_id === field.id); const value = display(current?.value); return <div key={field.id} className="space-y-1"><label htmlFor={`custom-${field.id}`} className="text-xs text-muted-foreground">{field.name}{field.is_required ? " *" : ""}</label>{canEdit ? <div className="flex gap-2"><input id={`custom-${field.id}`} type={field.field_type === "NUMBER" ? "number" : field.field_type === "DATE" ? "date" : "text"} value={value} onChange={(event) => setValues((items) => [...items.filter((item) => item.custom_field_id !== field.id), { custom_field_id: field.id, value: event.target.value }])} onBlur={(event) => void save(field, event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" placeholder={field.field_type.toLowerCase()} />{saving === field.id && <Loader2 className="mt-2 h-3 w-3 animate-spin text-primary" />}</div> : <p className="text-xs font-medium">{value || "—"}</p>}</div>; })}</div></section>;
}
