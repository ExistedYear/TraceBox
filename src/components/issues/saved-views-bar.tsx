"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { SavedViewRow } from "@/lib/validation/saved-views";
type Props = {
  projectId: string;
  currentFilters: Record<string, string>;
  savedViews: SavedViewRow[];
  onApply: (filters: Record<string, string>) => void;
  onViewsChange: (views: SavedViewRow[]) => void;
};

export function SavedViewsBar({ projectId, currentFilters, savedViews, onApply, onViewsChange }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Enter a view name.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await createClient().rpc("create_saved_view", {
        p_project_id: projectId,
        p_name: name.trim(),
        p_filters: currentFilters as any,
        p_is_shared: false,
      });
      if (error) {
        toast.error("Could not save view.");
        return;
      }
      const newView: SavedViewRow = {
        id: String(data),
        project_id: projectId,
        name: name.trim(),
        filters: { ...currentFilters },
        is_shared: false,
        created_by: "",
      };
      onViewsChange([...savedViews, newView]);
      setName("");
      toast.success("View saved.");
    } catch {
      toast.error("Could not reach server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await createClient().rpc("delete_saved_view", { p_view_id: id });
      if (error) {
        toast.error("Could not delete view.");
        return;
      }
      onViewsChange(savedViews.filter((v) => v.id !== id));
      toast.success("View deleted.");
    } catch {
      toast.error("Could not reach server.");
    }
  }

  async function handleShare(id: string) {
    const view = savedViews.find((v) => v.id === id);
    if (!view) return;
    const query = new URLSearchParams(view.filters).toString();
    const url = `${window.location.origin}${window.location.pathname}?${query}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard.");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-card/50 p-2">
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Bookmark className="h-3.5 w-3.5" /> Saved views:
      </div>

      {savedViews.length === 0 ? (
        <span className="text-xs text-muted-foreground">No saved views yet.</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {savedViews.map((view) => (
            <div key={view.id} className="group flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs">
              <button
                type="button"
                onClick={() => onApply(view.filters)}
                className="font-medium hover:text-primary"
              >
                {view.name}
              </button>
              <button
                type="button"
                onClick={() => void handleShare(view.id)}
                className="p-0.5 text-muted-foreground hover:text-primary"
                title="Copy shareable link"
              >
                <Share2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(view.id)}
                className="p-0.5 text-muted-foreground hover:text-destructive"
                title="Delete view"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Input
          placeholder="View name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 w-32 text-xs"
        />
        <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookmarkCheck className="h-3 w-3" />}
          Save current
        </Button>
      </div>
    </div>
  );
}
