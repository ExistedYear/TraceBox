"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export type TemplateRow = { id: string; name: string; description: string | null; issue_type: string; body_template: string; default_priority: string | null; default_severity: string | null; default_component_id: string | null };
type Props = { projectId: string; canManage: boolean; initialTemplates: TemplateRow[] };
const types = ["BUG", "ENHANCEMENT", "TASK", "SECURITY", "PERFORMANCE", "REGRESSION"];

export function IssueTemplatesManager({ projectId, canManage, initialTemplates }: Props) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState("BUG");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  function openEditor(template?: TemplateRow) {
    setEditorOpen(true);
    setEditing(template ?? null);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setIssueType(template?.issue_type ?? "BUG");
    setBody(template?.body_template ?? "");
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
    setName("");
    setDescription("");
    setIssueType("BUG");
    setBody("");
  }

  async function save() {
    if (!name.trim() || !body.trim()) {
      toast.error("Name and body are required.");
      return;
    }
    setSaving(true);
    try {
      const client = createClient();
      if (editing) {
        const { error } = await client.rpc("update_issue_template", { p_template_id: editing.id, p_name: name.trim(), p_description: description.trim(), p_issue_type: issueType, p_body_template: body.trim() });
        if (error) throw error;
        setTemplates((current) => current.map((item) => item.id === editing.id ? { ...item, name: name.trim(), description: description.trim() || null, issue_type: issueType, body_template: body.trim() } : item));
        toast.success("Template updated.");
      } else {
        const { data, error } = await client.rpc("create_issue_template", { p_project_id: projectId, p_name: name.trim(), p_description: description.trim(), p_issue_type: issueType, p_body_template: body.trim() });
        if (error) throw error;
        setTemplates((current) => [...current, { id: String(data), name: name.trim(), description: description.trim() || null, issue_type: issueType, body_template: body.trim(), default_priority: null, default_severity: null, default_component_id: null }]);
        toast.success("Template created.");
      }
      closeEditor();
    } catch {
      toast.error("Could not save template.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(template: TemplateRow) {
    if (!window.confirm(`Delete template \"${template.name}\"?`)) return;
    const { error } = await createClient().rpc("delete_issue_template", { p_template_id: template.id });
    if (error) {
      toast.error("Could not delete template.");
      return;
    }
    setTemplates((current) => current.filter((item) => item.id !== template.id));
    toast.success("Template deleted.");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Issue intake</p><h2 className="mt-1 text-lg font-semibold">Issue templates</h2><p className="mt-1 text-xs text-muted-foreground">Standardize reports so contributors provide the context your team needs.</p></div>{canManage && <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => openEditor()}><Plus className="h-3.5 w-3.5" /> New template</Button>}</div>
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <Surface><div className="flex items-center justify-between border-b border-border/80 px-4 py-3"><h3 className="text-sm font-semibold">Available templates</h3><span className="font-mono text-[10px] text-muted-foreground">{templates.length} total</span></div><div className="divide-y divide-border/70">{templates.length === 0 ? <p className="p-8 text-center text-xs text-muted-foreground">No templates yet.</p> : templates.map((template) => <div key={template.id} className="flex items-start justify-between gap-3 p-4"><div className="min-w-0"><p className="text-sm font-medium">{template.name}<span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{template.issue_type}</span></p><p className="mt-1 truncate text-xs text-muted-foreground">{template.description ?? template.body_template}</p></div>{canManage && <div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEditor(template)} aria-label={`Edit ${template.name}`}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => void remove(template)} aria-label={`Delete ${template.name}`}><Trash2 className="h-3 w-3" /></Button></div>}</div>)}</div></Surface>
        {editorOpen && <Surface className="p-4"><h3 className="text-sm font-semibold">{editing ? "Edit template" : "New template"}</h3><p className="mt-1 text-xs text-muted-foreground">Template bodies support Markdown and prefill the issue description.</p><div className="mt-4 space-y-3"><div><Label htmlFor="template-name" className="text-xs">Template name</Label><Input id="template-name" className="mt-1 h-8 text-xs" placeholder="Bug report" value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label htmlFor="template-description" className="text-xs">Short description</Label><Input id="template-description" className="mt-1 h-8 text-xs" placeholder="Use for product defects" value={description} onChange={(event) => setDescription(event.target.value)} /></div><div><Label htmlFor="template-type" className="text-xs">Issue type</Label><select id="template-type" className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs" value={issueType} onChange={(event) => setIssueType(event.target.value)}>{types.map((type) => <option key={type}>{type}</option>)}</select></div><div><Label htmlFor="template-body" className="text-xs">Template body</Label><textarea id="template-body" className="mt-1 min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" placeholder="## What happened?" value={body} onChange={(event) => setBody(event.target.value)} /></div><div className="flex justify-end gap-2"><Button variant="outline" size="sm" className="h-8 text-xs" onClick={closeEditor}>Cancel</Button><Button size="sm" className="h-8 text-xs" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save template"}</Button></div></div></Surface>}
      </div>
    </div>
  );
}
