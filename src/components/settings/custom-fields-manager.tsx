"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { humanizeEnum } from "@/lib/issues";
import { createClient } from "@/lib/supabase/client";

type Field = { id: string; name: string; field_type: string; config: Record<string, unknown>; is_required: boolean };
type Props = { projectId: string; canManage: boolean; initialFields: Field[] };
const fieldTypes = ["TEXT", "NUMBER", "BOOLEAN", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "USER"];

export function CustomFieldsManager({ projectId, canManage, initialFields }: Props) {
  const [fields, setFields] = useState(initialFields);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("TEXT");
  const [fieldOptions, setFieldOptions] = useState("");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingType, setEditingType] = useState("TEXT");
  const [editingOptions, setEditingOptions] = useState("");
  const [editingRequired, setEditingRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsOptions = fieldType === "SINGLE_SELECT" || fieldType === "MULTI_SELECT";

  async function addField() {
    if (busy || !fieldName.trim() || !canManage) return;
    const options = fieldOptions.split(",").map((item) => item.trim()).filter(Boolean);
    if (needsOptions && options.length === 0) { toast.error("Add at least one comma-separated option."); return; }
    const config = needsOptions ? { options: [...new Set(options)] } : {};
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("create_custom_field", { p_project_id: projectId, p_name: fieldName.trim(), p_field_type: fieldType, p_config: config, p_is_required: fieldRequired });
      if (error) { toast.error("Could not create custom field."); return; }
      setFields((current) => [...current, { id: String(data), name: fieldName.trim(), field_type: fieldType, config, is_required: fieldRequired }]);
      setFieldName(""); setFieldOptions(""); setFieldRequired(false);
      toast.success("Custom field created.");
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  async function deleteField(id: string) {
    if (busy || !canManage || !window.confirm("Delete this custom field and all of its issue values?")) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("delete_custom_field", { p_field_id: id });
      if (error) { toast.error("Could not delete custom field."); return; }
      setFields((current) => current.filter((field) => field.id !== id));
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  function beginEdit(field: Field) {
    setEditingId(field.id); setEditingName(field.name); setEditingType(field.field_type);
    setEditingOptions(Array.isArray(field.config.options) ? field.config.options.join(", ") : ""); setEditingRequired(field.is_required);
  }

  async function updateField(field: Field) {
    const options = editingOptions.split(",").map((item) => item.trim()).filter(Boolean);
    if (!editingName.trim() || ((editingType === "SINGLE_SELECT" || editingType === "MULTI_SELECT") && options.length === 0)) { toast.error("Provide a name and valid select options."); return; }
    setBusy(true);
    try {
      const config = editingType === "SINGLE_SELECT" || editingType === "MULTI_SELECT" ? { options: [...new Set(options)] } : {};
      const { error } = await createClient().rpc("update_custom_field", { p_field_id: field.id, p_name: editingName.trim(), p_field_type: editingType, p_config: config, p_is_required: editingRequired });
      if (error) { toast.error(error.message.includes("values exist") ? "Type cannot change while values exist." : "Could not update custom field."); return; }
      setFields((current) => current.map((item) => item.id === field.id ? { ...item, name: editingName.trim(), field_type: editingType, config, is_required: editingRequired } : item));
      setEditingId(null); toast.success("Custom field updated.");
    } catch { toast.error("Could not reach the server."); } finally { setBusy(false); }
  }

  return <div>
    <Surface>
      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3"><div><h2 className="text-sm font-semibold">Custom fields</h2><p className="mt-0.5 text-xs text-muted-foreground">Add typed project-specific metadata to issues.</p></div><span className="font-mono text-[10px] text-muted-foreground">{fields.length} fields</span></div>
      {canManage ? <div className="grid items-end gap-3 border-b border-border/70 p-4 sm:grid-cols-[minmax(180px,1fr)_170px_auto]">
        <div><Label htmlFor="custom-field-name" className="text-xs">Field name</Label><Input id="custom-field-name" className="mt-1 h-8 text-xs" placeholder="Customer impact" value={fieldName} onChange={(event) => setFieldName(event.target.value)} /></div>
        <div><Label htmlFor="custom-field-type" className="text-xs">Field type</Label><select id="custom-field-type" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={fieldType} onChange={(event) => setFieldType(event.target.value)}>{fieldTypes.map((type) => <option key={type} value={type}>{humanizeEnum(type)}</option>)}</select></div>
        <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => void addField()} disabled={busy}><Plus className="h-3 w-3" /> Add field</Button>
        {needsOptions && <div className="sm:col-span-2"><Label htmlFor="custom-field-options" className="text-xs">Select options</Label><Input id="custom-field-options" className="mt-1 h-8 text-xs" placeholder="High, Medium, Low" value={fieldOptions} onChange={(event) => setFieldOptions(event.target.value)} /></div>}
        <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={fieldRequired} onChange={(event) => setFieldRequired(event.target.checked)} /> Required on issues</label>
      </div> : <p className="border-b border-border/70 p-4 text-xs text-muted-foreground">Only project maintainers can manage custom fields.</p>}
      <ul className="divide-y divide-border/70">{fields.length === 0 ? <li className="p-8 text-center text-xs text-muted-foreground">No custom fields configured.</li> : fields.map((field) => editingId === field.id ? <li key={field.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_150px_1fr_auto] sm:items-end"><div><Label htmlFor={`edit-field-name-${field.id}`} className="text-[10px]">Name</Label><Input id={`edit-field-name-${field.id}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} className="h-7 text-xs" /></div><div><Label htmlFor={`edit-field-type-${field.id}`} className="text-[10px]">Type</Label><select id={`edit-field-type-${field.id}`} value={editingType} onChange={(event) => setEditingType(event.target.value)} className="h-7 w-full rounded border border-input bg-background px-1 text-xs">{fieldTypes.map((type) => <option key={type} value={type}>{humanizeEnum(type)}</option>)}</select></div><div>{(editingType === "SINGLE_SELECT" || editingType === "MULTI_SELECT") && <><Label htmlFor={`edit-field-options-${field.id}`} className="text-[10px]">Options</Label><Input id={`edit-field-options-${field.id}`} value={editingOptions} onChange={(event) => setEditingOptions(event.target.value)} className="h-7 text-xs" placeholder="High, Medium, Low" /></>}<label className="mt-1 flex items-center gap-1 text-[10px]"><input type="checkbox" checked={editingRequired} onChange={(event) => setEditingRequired(event.target.checked)} /> Required</label></div><div className="flex gap-1"><Button size="sm" className="h-7 text-xs" onClick={() => void updateField(field)} disabled={busy}>Save</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)} disabled={busy}>Cancel</Button></div></li> : <li key={field.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"><span className="min-w-0"><span className="font-medium">{field.name}</span>{field.is_required && <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-600 dark:text-amber-300">required</span>}<span className="ml-2 text-[10px] text-muted-foreground">{humanizeEnum(field.field_type)}</span></span>{canManage && <span className="flex gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => beginEdit(field)} disabled={busy} aria-label={`Edit ${field.name}`}>Edit</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => void deleteField(field.id)} disabled={busy} aria-label={`Delete ${field.name}`}><Trash2 className="h-3 w-3" /></Button></span>}</li>)}</ul>
    </Surface>
  </div>;
}
