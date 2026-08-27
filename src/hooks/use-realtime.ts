"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

type RealtimeConfig = {
  table: string;
  filter?: string;
  onInsert?: (payload: unknown) => void;
  onUpdate?: (payload: unknown) => void;
  onDelete?: (payload: unknown) => void;
  enabled?: boolean;
};

export function useRealtimeSubscription(config: RealtimeConfig) {
  const { table, filter, onInsert, onUpdate, onDelete, enabled = true } = config;
  const onInsertRef = useRef(onInsert);
  const onUpdateRef = useRef(onUpdate);
  const onDeleteRef = useRef(onDelete);

  useEffect(() => {
    onInsertRef.current = onInsert;
  }, [onInsert]);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    onDeleteRef.current = onDelete;
  }, [onDelete]);

  useEffect(() => {
    if (!enabled || !table) return;

    const supabase = createClient();
    const channelName = `realtime:${table}:${filter ?? "all"}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table,
          filter,
        },
        (payload: any) => {
          onInsertRef.current?.(payload.new);
        },
      )
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table,
          filter,
        },
        (payload: any) => {
          onUpdateRef.current?.(payload.new);
        },
      )
      .on(
        "postgres_changes" as any,
        {
          event: "DELETE",
          schema: "public",
          table,
          filter,
        },
        (payload: any) => {
          onDeleteRef.current?.(payload.old);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled]);
}

export function useRealtimeComments(
  issueId: string,
  callbacks:
    | {
        onInsert?: (comment: unknown) => void;
        onUpdate?: (comment: unknown) => void;
        onDelete?: (comment: unknown) => void;
      }
    | ((comment: unknown) => void),
) {
  const onInsert = typeof callbacks === "function" ? callbacks : callbacks.onInsert;
  const onUpdate = typeof callbacks === "function" ? undefined : callbacks.onUpdate;
  const onDelete = typeof callbacks === "function" ? undefined : callbacks.onDelete;

  useRealtimeSubscription({
    table: "comments",
    filter: `issue_id=eq.${issueId}`,
    onInsert,
    onUpdate,
    onDelete,
    enabled: Boolean(issueId),
  });
}

export function useRealtimeIssueUpdates(projectId: string, onUpdate: (issue: unknown) => void) {
  useRealtimeSubscription({
    table: "issues",
    filter: `project_id=eq.${projectId}`,
    onUpdate,
    onInsert: onUpdate,
    enabled: Boolean(projectId),
  });
}

export function useRealtimeNotifications(userId: string, onNotification: (notification: unknown) => void) {
  useRealtimeSubscription({
    table: "notifications",
    filter: `user_id=eq.${userId}`,
    onInsert: onNotification,
    enabled: Boolean(userId),
  });
}
