"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useRealtimeIssueUpdates } from "@/hooks/use-realtime";

/** Keeps read-only issue detail pages current without exposing unrelated rows. */
export function IssueRealtimeRefresh({ projectId, issueId, enabled = true }: { projectId: string; issueId: string; enabled?: boolean }) {
  const router = useRouter();
  const onUpdate = useCallback((payload: unknown) => {
    if (payload && typeof payload === "object" && (payload as { id?: unknown }).id === issueId) router.refresh();
  }, [issueId, router]);
  const onDelete = useCallback((payload: unknown) => {
    if (payload && typeof payload === "object" && (payload as { id?: unknown }).id === issueId) router.replace("/dashboard/issues");
  }, [issueId, router]);
  const onError = useCallback(() => toast.error("Live issue updates disconnected. Reload to verify the latest version."), []);
  useRealtimeIssueUpdates(projectId, onUpdate, onDelete, onError, () => router.refresh(), enabled);
  return null;
}
