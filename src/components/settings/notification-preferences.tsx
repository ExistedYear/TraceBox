"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";

const preferenceRows: Array<{ key: keyof typeof DEFAULT_NOTIFICATION_PREFERENCES; label: string; description: string }> = [
  { key: "assignments", label: "Assignments", description: "When an issue is assigned to you." },
  { key: "mentions", label: "Mentions", description: "When someone mentions you in a comment." },
  { key: "comments", label: "Comments", description: "When someone comments on an issue you watch." },
  { key: "status_changes", label: "Status changes", description: "When the status changes on an issue you watch." },
  { key: "watch_updates", label: "Watched issue updates", description: "When the details of an issue you watch change." },
  { key: "issue_links", label: "Issue links", description: "When an issue is linked to an issue you watch." },
  { key: "labels", label: "Label changes", description: "When labels change on an issue you watch." },
  { key: "planning", label: "Planning updates", description: "When versions or planning metadata change." },
  { key: "milestones", label: "Milestone updates", description: "When a milestone changes on an issue you watch." },
];

export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await createClient().rpc("get_notification_preferences");
    if (loadError) {
      console.error("Notification preferences load failed", { code: loadError.code, message: loadError.message });
      setError("Notification preferences are unavailable right now.");
    } else {
      const row = (data?.[0] ?? null) as NotificationPreferences | null;
      setPreferences(row);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(key: keyof typeof DEFAULT_NOTIFICATION_PREFERENCES) {
    if (!preferences || saving) return;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSaving(true);
    const { error: saveError } = await createClient().rpc("update_notification_preferences", {
      p_mentions: next.mentions,
      p_assignments: next.assignments,
      p_comments: next.comments,
      p_status_changes: next.status_changes,
      p_watch_updates: next.watch_updates,
      p_issue_links: next.issue_links,
      p_labels: next.labels,
      p_planning: next.planning,
      p_milestones: next.milestones,
    });
    setSaving(false);
    if (saveError) {
      setPreferences(preferences);
      toast.error("Could not save notification preferences.");
    } else {
      toast.success("Notification preference updated.");
    }
  }

  if (loading) return <div className="flex items-center gap-2 rounded-[10px] border border-border/80 bg-card/50 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading notification preferences</div>;
  if (error || !preferences) return <div role="alert" className="rounded-[10px] border border-destructive/30 bg-destructive/5 p-8"><p className="text-sm font-medium">{error ?? "Notification preferences could not be loaded."}</p><Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /> Try again</Button></div>;

  return (
    <div className="space-y-5">
      <div><p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Personal</p><h2 className="mt-1 text-xl font-semibold">Notification preferences</h2><p className="mt-1 text-sm text-muted-foreground">Choose which in-app updates appear in your inbox and header preview.</p></div>
      <div className="rounded-[10px] border border-border/80 bg-card/50">
        {preferenceRows.map((row, index) => <div key={row.key} className={`flex items-center justify-between gap-4 px-4 py-3.5 ${index ? "border-t border-border/70" : ""}`}><div className="min-w-0"><p className="text-sm font-medium">{row.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p></div><button type="button" role="switch" aria-checked={preferences[row.key]} onClick={() => void toggle(row.key)} disabled={saving} className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors ${preferences[row.key] ? "border-primary bg-primary" : "border-border bg-muted"}`}><span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-background transition-transform ${preferences[row.key] ? "left-[20px]" : "left-0.5"}`} /> <span className="sr-only">{preferences[row.key] ? "Disable" : "Enable"} {row.label}</span></button></div>)}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bell className="h-3.5 w-3.5" /> TraceBox currently delivers notifications in-app only.</p>
      {saving ? <p role="status" className="text-xs text-muted-foreground">Saving…</p> : null}
    </div>
  );
}
