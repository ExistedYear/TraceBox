"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, Check, Loader2, Pencil, Save, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { encodeSavedViewLink, type SavedViewRow } from "@/lib/validation/saved-views";

type Props = {
  projectId: string;
  currentFilters: Record<string, string>;
  savedViews: SavedViewRow[];
  currentUserId: string;
  canManageProject: boolean;
  onApply: (filters: Record<string, string>) => void;
  onViewsChange: (views: SavedViewRow[]) => void;
};

const visibilityLabel = { PRIVATE: "Private", PROJECT: "Project", ORGANIZATION: "Workspace" } as const;

export function SavedViewsBar({ projectId, currentFilters, savedViews, currentUserId, canManageProject, onApply, onViewsChange }: Props) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<SavedViewRow["visibility"]>("PRIVATE");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  async function handleSave() {
    if (!name.trim()) { toast.error("Enter a view name."); return; }
    setSaving(true);
    try {
      const { data, error } = await createClient().rpc("create_saved_view", { p_project_id: projectId, p_name: name.trim(), p_filters: currentFilters, p_visibility: visibility });
      if (error) throw error;
      onViewsChange([...savedViews, { id: String(data), project_id: projectId, name: name.trim(), filters: { ...currentFilters }, visibility, created_by: currentUserId }]);
      setName("");
      toast.success("View saved.");
    } catch (error) { console.error("Saved view create failed", error); toast.error("Could not save view."); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await createClient().rpc("delete_saved_view", { p_view_id: id });
      if (error) throw error;
      onViewsChange(savedViews.filter((view) => view.id !== id));
      toast.success("View deleted.");
    } catch (error) { console.error("Saved view delete failed", error); toast.error("Could not delete view."); }
  }

  async function handleRename(view: SavedViewRow) {
    if (!editingName.trim()) { toast.error("Enter a view name."); return; }
    try {
      const { error } = await createClient().rpc("rename_saved_view", { p_view_id: view.id, p_name: editingName.trim() });
      if (error) throw error;
      onViewsChange(savedViews.map((item) => item.id === view.id ? { ...item, name: editingName.trim() } : item));
      setEditingId(null);
      toast.success("View renamed.");
    } catch (error) { console.error("Saved view rename failed", error); toast.error("Could not rename view."); }
  }

  async function handleUpdateFilters(view: SavedViewRow) {
    try {
      const { error } = await createClient().rpc("update_saved_view_filters", { p_view_id: view.id, p_filters: currentFilters });
      if (error) throw error;
      onViewsChange(savedViews.map((item) => item.id === view.id ? { ...item, filters: { ...currentFilters } } : item));
      toast.success("View filters updated.");
    } catch (error) { console.error("Saved view filter update failed", error); toast.error("Could not update view filters."); }
  }

  async function handleVisibility(view: SavedViewRow, nextVisibility: SavedViewRow["visibility"]) {
    try {
      const { error } = await createClient().rpc("update_saved_view_visibility", { p_view_id: view.id, p_visibility: nextVisibility });
      if (error) throw error;
      onViewsChange(savedViews.map((item) => item.id === view.id ? { ...item, visibility: nextVisibility } : item));
      toast.success(`View is now ${visibilityLabel[nextVisibility].toLowerCase()}.`);
    } catch (error) { console.error("Saved view visibility update failed", error); toast.error("Could not change view sharing."); }
  }

  async function handleCopy(view: SavedViewRow) {
    const url = `${window.location.origin}${window.location.pathname}${encodeSavedViewLink(view.id)}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(url);
      toast.success("Saved-view link copied.");
    } catch (error) { console.error("Saved view link copy failed", error); toast.error("Could not copy the link. Copy it from the address bar instead."); }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/80 bg-card/50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Bookmark className="h-3.5 w-3.5" /><span>Saved views</span></div>
        {savedViews.length === 0 ? <span className="text-xs text-muted-foreground">No saved views yet.</span> : <div className="flex flex-wrap gap-1.5">{savedViews.map((view) => <div key={view.id} className="group flex flex-wrap items-center gap-1 rounded-full border bg-background px-2 py-1 text-xs">
          {editingId === view.id ? <><Input aria-label={`Rename ${view.name}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} className="h-6 w-28 text-xs" autoFocus /><button type="button" onClick={() => void handleRename(view)} className="p-0.5 text-primary" aria-label="Save name"><Check className="h-3 w-3" /></button><button type="button" onClick={() => setEditingId(null)} className="p-0.5 text-muted-foreground" aria-label="Cancel rename"><X className="h-3 w-3" /></button></> : <button type="button" onClick={() => onApply(view.filters)} className="font-medium hover:text-primary">{view.name}</button>}
          {editingId !== view.id ? <>{view.created_by === currentUserId ? <select aria-label={`${view.name} visibility`} value={view.visibility} onChange={(event) => void handleVisibility(view, event.target.value as SavedViewRow["visibility"])} className="h-5 rounded border-0 bg-transparent px-0 text-[10px] text-muted-foreground"><option value="PRIVATE">Private</option><option value="PROJECT">Project</option>{canManageProject ? <option value="ORGANIZATION">Workspace</option> : null}</select> : <span className="px-0 text-[10px] text-muted-foreground" aria-label={`${view.name} visibility`}>{visibilityLabel[view.visibility]}</span>}<button type="button" onClick={() => void handleCopy(view)} className="p-0.5 text-muted-foreground hover:text-primary" title="Copy stable saved-view link" aria-label="Copy saved-view link"><Share2 className="h-3 w-3" /></button>{view.created_by === currentUserId ? <><button type="button" onClick={() => { setEditingId(view.id); setEditingName(view.name); }} className="p-0.5 text-muted-foreground hover:text-primary" title="Rename view" aria-label="Rename view"><Pencil className="h-3 w-3" /></button><button type="button" onClick={() => void handleUpdateFilters(view)} className="p-0.5 text-muted-foreground hover:text-primary" title="Replace saved filters with current filters" aria-label="Update saved filters"><Save className="h-3 w-3" /></button><button type="button" onClick={() => void handleDelete(view.id)} className="p-0.5 text-muted-foreground hover:text-destructive" title="Delete view" aria-label="Delete view"><Trash2 className="h-3 w-3" /></button></> : null}</> : null}
        </div>)}</div>}
      </div>
      <div className="flex flex-wrap items-end gap-1.5 border-t border-border/50 pt-2">
        <div><label htmlFor="saved-view-name" className="mb-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Save view</label><Input id="saved-view-name" placeholder="View name" value={name} onChange={(event) => setName(event.target.value)} className="h-7 w-32 text-xs" /></div>
        <div><label htmlFor="saved-view-visibility" className="mb-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">Visibility</label><select id="saved-view-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as SavedViewRow["visibility"])} className="h-7 rounded-md border border-input bg-background px-2 text-xs"><option value="PRIVATE">Private</option><option value="PROJECT">Project</option>{canManageProject ? <option value="ORGANIZATION">Workspace</option> : null}</select></div>
        <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => void handleSave()} disabled={saving}>{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookmarkCheck className="h-3 w-3" />} Save current</Button>
      </div>
    </div>
  );
}
