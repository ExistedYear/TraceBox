"use client";

import { useState } from "react";
import { Globe2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { createClient } from "@/lib/supabase/client";

export function WorkspaceVisibility({ organizationId, initialPublic }: { organizationId: string; initialPublic: boolean }) {
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [saving, setSaving] = useState(false);
  async function toggle() {
    const next = !isPublic; setSaving(true);
    const { error } = await createClient().rpc("set_organization_public", { p_organization_id: organizationId, p_is_public: next });
    setSaving(false);
    if (error) { toast.error("Could not update workspace visibility."); return; }
    setIsPublic(next); toast.success(next ? "Workspace published." : "Workspace removed from discovery.");
  }
  return <Surface className="mb-6 flex items-center justify-between gap-4 p-4"><div className="flex items-start gap-3"><Globe2 className="mt-0.5 h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold">Public workspace</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Public workspaces appear in Discover. Signed-in users can join as workspace members and project reporters.</p></div></div><button type="button" role="switch" aria-checked={isPublic} aria-label="Publish workspace" disabled={saving} onClick={() => void toggle()} className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${isPublic ? "border-primary bg-primary" : "border-border bg-muted"}`}><span className={`absolute left-1 top-1 h-[18px] w-[18px] rounded-full bg-background shadow transition-transform ${isPublic ? "translate-x-5" : "translate-x-0"}`} />{saving ? <Loader2 className="absolute -left-6 top-1.5 h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}</button></Surface>;
}
