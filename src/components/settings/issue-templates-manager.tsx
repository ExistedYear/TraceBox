"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Issue templates</h2><p className="text-xs text-muted-foreground">Standardize issue reports for this project.</p></div>{canManage && <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => openEditor()}><Plus className="h-3.5 w-3.5" /> New template</Button>}</div>
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="divide-y divide-border/70 rounded-lg border border-border/80">{templates.length === 0 ? <p className="p-8 text-center text-xs text-muted-foreground">No templates yet.</p> : templates.map((template) => <div key={template.id} className="flex items-start justify-between gap-3 p-3"><div className="min-w-0"><p className="font-medium text-sm">{template.name} <span className="ml-1 text-[10px] text-muted-foreground">{template.issue_type.toLowerCase()}</span></p><p className="mt-1 truncate text-xs text-muted-foreground">{template.description ?? template.body_template}</p></div>{canManage && <div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEditor(template)} aria-label={`Edit ${template.name}`}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => void remove(template)} aria-label={`Delete ${template.name}`}><Trash2 className="h-3 w-3" /></Button></div>}</div>)}</div>
        {editorOpen && <div className="space-y-3 rounded-lg border border-border/80 bg-card/40 p-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{editing ? "Edit template" : "New template"}</h3><Input placeholder="template name" value={name} onChange={(event) => setName(event.target.value)} /><Input placeholder="short description" value={description} onChange={(event) => setDescription(event.target.value)} /><select aria-label="Template issue type" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={issueType} onChange={(event) => setIssueType(event.target.value)}>{types.map((type) => <option key={type}>{type}</option>)}</select><textarea aria-label="Template body" className="min-h-40 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="markdown issue body" value={body} onChange={(event) => setBody(event.target.value)} /><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={closeEditor}>Cancel</Button><Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? "Saving..." : "Save template"}</Button></div></div>}
      </div>
    </div>
  );
}
