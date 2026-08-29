"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";

type RealtimeConfig = {
  table: string;
  filter?: string;
  onInsert?: (payload: unknown) => void;
  onUpdate?: (payload: unknown) => void;
  onDelete?: (payload: unknown) => void;
  onError?: () => void;
  onReconnect?: () => void;
  enabled?: boolean;
};

export function useRealtimeSubscription(config: RealtimeConfig) {
  const { table, filter, onInsert, onUpdate, onDelete, onError, onReconnect, enabled = true } = config;
  const onInsertRef = useRef(onInsert);
  const onUpdateRef = useRef(onUpdate);
  const onDeleteRef = useRef(onDelete);
  const onErrorRef = useRef(onError);
  const onReconnectRef = useRef(onReconnect);

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
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    if (!enabled || !table) return;

    const supabase = createClient();
    const channelName = `realtime:${table}:${filter ?? "all"}:${crypto.randomUUID()}`;
    let disconnected = false;
    let disposed = false;

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
          if (disposed) return;
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
          if (disposed) return;
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
          if (disposed) return;
          onDeleteRef.current?.(payload.old);
        },
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          disconnected = true;
          onErrorRef.current?.();
        } else if (status === "SUBSCRIBED" && disconnected) {
          disconnected = false;
          onReconnectRef.current?.();
        }
      });

    return () => {
      disposed = true;
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
        onError?: () => void;
      }
    | ((comment: unknown) => void),
) {
  const onInsert = typeof callbacks === "function" ? callbacks : callbacks.onInsert;
  const onUpdate = typeof callbacks === "function" ? undefined : callbacks.onUpdate;
  const onDelete = typeof callbacks === "function" ? undefined : callbacks.onDelete;
  const onError = typeof callbacks === "function" ? undefined : callbacks.onError;

  useRealtimeSubscription({
    table: "comments",
    filter: `issue_id=eq.${issueId}`,
    onInsert,
    onUpdate,
    onDelete,
    onError,
    enabled: Boolean(issueId),
  });
}

export function useRealtimeIssueUpdates(projectId: string, onUpdate: (issue: unknown) => void, onDelete?: (issue: unknown) => void, onError?: () => void, onReconnect?: () => void, enabled = true) {
  useRealtimeSubscription({
    table: "issues",
    filter: `project_id=eq.${projectId}`,
    onUpdate,
    onInsert: onUpdate,
    onDelete,
    onError,
    onReconnect,
    enabled: Boolean(projectId) && enabled,
  });
}

export function useRealtimeNotifications(userId: string, onNotification: (notification: unknown) => void, onError?: () => void, onReconnect?: () => void) {
  useRealtimeSubscription({
    table: "notifications",
    filter: `user_id=eq.${userId}`,
    onInsert: onNotification,
    onError,
    onReconnect,
    enabled: Boolean(userId),
  });
}
