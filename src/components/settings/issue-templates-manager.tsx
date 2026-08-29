"use client";

import { useState } from "react";
import { Copy, Eye, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { MarkdownContent } from "@/components/tracebox/markdown-content";
import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export type TemplateRow = { id: string; name: string; description: string | null; issue_type: string; body_template: string; default_priority: string | null; default_severity: string | null; default_component_id: string | null; is_archived?: boolean; label_ids?: string[] };
type Props = { projectId: string; canManage: boolean; initialTemplates: TemplateRow[]; components?: Array<{ id: string; name: string }>; labels?: Array<{ id: string; name: string }> };
const types = ["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"];

export function IssueTemplatesManager({ projectId, canManage, initialTemplates, components = [], labels = [] }: Props) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("BUG");
  const [body, setBody] = useState("");
  const [defaultPriority, setDefaultPriority] = useState<string>("");
  const [defaultSeverity, setDefaultSeverity] = useState<string>("");
  const [defaultComponent, setDefaultComponent] = useState<string>("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [preview, setPreview] = useState<TemplateRow | null>(null);
  const [saving, setSaving] = useState(false);

  function openEditor(template?: TemplateRow) {
    setEditorOpen(true);
    setEditing(template ?? null);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setIssueType(template?.issue_type ?? "BUG");
    setBody(template?.body_template ?? "");
    setDefaultPriority(template?.default_priority ?? "");
    setDefaultSeverity(template?.default_severity ?? "");
    setDefaultComponent(template?.default_component_id ?? "");
    setSelectedLabels(template?.label_ids ?? []);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
    setName("");
    setDescription("");
    setIssueType("BUG");
    setBody("");
    setDefaultPriority("");
    setDefaultSeverity("");
    setDefaultComponent("");
    setSelectedLabels([]);
  }

  async function save() {
    if (!name.trim() || !body.trim()) {
      toast.error("Name and body are required.");
      return;
    }
    setSaving(true);
    try {
      const client = createClient() as any;
      if (editing) {
        const { error } = await client.rpc("update_issue_template_complete", { p_template_id: editing.id, p_name: name.trim(), p_description: description.trim(), p_issue_type: issueType, p_body_template: body.trim(), p_default_priority: defaultPriority || null, p_default_severity: defaultSeverity || null, p_default_component_id: defaultComponent || null, p_label_ids: selectedLabels });
        if (error) throw error;
        setTemplates((current) => current.map((item) => item.id === editing.id ? { ...item, name: name.trim(), description: description.trim() || null, issue_type: issueType, body_template: body.trim(), default_priority: defaultPriority || null, default_severity: defaultSeverity || null, default_component_id: defaultComponent || null, label_ids: selectedLabels } : item));
        toast.success("Template updated.");
      } else {
        const { data, error } = await client.rpc("create_issue_template_complete", { p_project_id: projectId, p_name: name.trim(), p_description: description.trim(), p_issue_type: issueType, p_body_template: body.trim(), p_default_priority: defaultPriority || null, p_default_severity: defaultSeverity || null, p_default_component_id: defaultComponent || null, p_label_ids: selectedLabels });
        if (error) throw error;
        setTemplates((current) => [...current, { id: String(data), name: name.trim(), description: description.trim() || null, issue_type: issueType, body_template: body.trim(), default_priority: defaultPriority || null, default_severity: defaultSeverity || null, default_component_id: defaultComponent || null, label_ids: selectedLabels }]);
        toast.success("Template created.");
      }
      closeEditor();
    } catch {
      toast.error("Could not save template.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(template: TemplateRow) {
    const { error } = await (createClient() as any).rpc("set_issue_template_archived", { p_template_id: template.id, p_archived: !template.is_archived });
    if (error) { toast.error("Could not update template status."); return; }
    setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, is_archived: !template.is_archived } : item));
    toast.success(template.is_archived ? "Template restored." : "Template archived.");
  }

  async function duplicate(template: TemplateRow) {
    const { data, error } = await (createClient() as any).rpc("duplicate_issue_template", { p_template_id: template.id, p_name: `${template.name} copy` });
    if (error) { toast.error("Could not duplicate template."); return; }
    setTemplates((current) => [...current, { ...template, id: String(data), name: `${template.name} copy`, is_archived: false }]);
    toast.success("Template duplicated.");
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Issue intake</p><h2 className="mt-1 text-lg font-semibold">Issue templates</h2><p className="mt-1 text-xs text-muted-foreground">Standardize reports so contributors provide the context your team needs.</p></div>{canManage && <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => openEditor()}><Plus className="h-3.5 w-3.5" /> New template</Button>}</div>
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <Surface><div className="flex items-center justify-between border-b border-border/80 px-4 py-3"><h3 className="text-sm font-semibold">Available templates</h3><span className="font-mono text-[10px] text-muted-foreground">{templates.length} total</span></div><div className="divide-y divide-border/70">{templates.length === 0 ? <p className="p-8 text-center text-xs text-muted-foreground">No templates yet.</p> : templates.map((template) => <div key={template.id} className="flex items-start justify-between gap-3 p-4"><div className="min-w-0"><p className="text-sm font-medium">{template.name}<span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{template.issue_type}</span>{template.is_archived && <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-700">Archived</span>}</p><p className="mt-1 truncate text-xs text-muted-foreground">{template.description ?? template.body_template}</p></div>{canManage && <div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setPreview(template)} aria-label={`Preview ${template.name}`}><Eye className="h-3 w-3" /></Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEditor(template)} aria-label={`Edit ${template.name}`}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void duplicate(template)} aria-label={`Duplicate ${template.name}`}><Copy className="h-3 w-3" /></Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void toggleArchive(template)} aria-label={`${template.is_archived ? "Restore" : "Archive"} ${template.name}`}>{template.is_archived ? <RotateCcw className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}</Button></div>}</div>)}</div></Surface>
        {editorOpen && <Surface className="p-4"><h3 className="text-sm font-semibold">{editing ? "Edit template" : "New template"}</h3><p className="mt-1 text-xs text-muted-foreground">Template bodies support Markdown and prefill the issue description.</p><div className="mt-4 space-y-3"><div><Label htmlFor="template-name" className="text-xs">Template name</Label><Input id="template-name" className="mt-1 h-8 text-xs" placeholder="Bug report" value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label htmlFor="template-description" className="text-xs">Short description</Label><Input id="template-description" className="mt-1 h-8 text-xs" placeholder="Use for product defects" value={description} onChange={(event) => setDescription(event.target.value)} /></div><div><Label htmlFor="template-type" className="text-xs">Issue type</Label><select id="template-type" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={issueType} onChange={(event) => setIssueType(event.target.value)}>{types.map((type) => <option key={type}>{type}</option>)}</select></div><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="template-priority" className="text-xs">Default priority</Label><select id="template-priority" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={defaultPriority} onChange={(event) => setDefaultPriority(event.target.value)}><option value="">Project default</option>{["P0","P1","P2","P3","P4"].map((value) => <option key={value}>{value}</option>)}</select></div><div><Label htmlFor="template-severity" className="text-xs">Default severity</Label><select id="template-severity" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={defaultSeverity} onChange={(event) => setDefaultSeverity(event.target.value)}><option value="">Project default</option>{["BLOCKER","CRITICAL","MAJOR","MINOR","TRIVIAL"].map((value) => <option key={value}>{value}</option>)}</select></div></div><div><Label htmlFor="template-component" className="text-xs">Default component</Label><select id="template-component" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={defaultComponent} onChange={(event) => setDefaultComponent(event.target.value)}><option value="">No default</option>{components.map((component) => <option key={component.id} value={component.id}>{component.name}</option>)}</select></div><div><Label className="text-xs">Default labels</Label><div className="mt-1 flex flex-wrap gap-2">{labels.map((label) => <label key={label.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={selectedLabels.includes(label.id)} onChange={(event) => setSelectedLabels((current) => event.target.checked ? [...current, label.id] : current.filter((id) => id !== label.id))} />{label.name}</label>)}</div></div><div><Label htmlFor="template-body" className="text-xs">Template body</Label><textarea id="template-body" className="mt-1 min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" placeholder="## What happened?" value={body} onChange={(event) => setBody(event.target.value)} /></div><div className="flex justify-end gap-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={closeEditor}>Cancel</Button><Button size="sm" className="h-8 text-xs" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save template"}</Button></div></div></Surface>}
        {preview && <Surface className="p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Preview · {preview.name}</h3><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPreview(null)}>Close</Button></div><div className="mt-2 rounded-md bg-muted/40 p-3"><MarkdownContent body={preview.body_template} /></div><p className="mt-2 text-xs text-muted-foreground">{preview.default_priority ?? "P2"} · {preview.default_severity ?? "MAJOR"}</p></Surface>}
      </div>
    </div>
  );
}
