"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";

import {
  notificationPageFromRows,
  type NotificationCursor,
  type NotificationItem,
} from "@/lib/notifications";
import { useRealtimeSubscription } from "@/hooks/use-realtime";
import { createClient } from "@/lib/supabase/client";

type UseNotificationFeedOptions = {
  unreadOnly?: boolean;
  pageSize?: number;
  realtime?: boolean;
};

export function useNotificationFeed({ unreadOnly = false, pageSize = 25, realtime = true }: UseNotificationFeedOptions = {}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cursor, setCursor] = useState<NotificationCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState(false);

  const refreshCount = useCallback(async () => {
    const { data, error: countError } = await createClient().rpc("get_unread_notifications_count");
    if (countError || typeof data !== "number") {
      console.error("Unread notification count failed", countError ?? { message: "invalid response" });
      return;
    }
    setUnreadCount(data);
  }, []);

  const fetchPage = useCallback(async (nextCursor: NotificationCursor | null, append: boolean) => {
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const supabase = createClient();
      const [{ data: authData, error: authError }, { data, error: pageError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("list_notifications", {
          p_cursor_created_at: nextCursor?.createdAt ?? null,
          p_cursor_id: nextCursor?.id ?? null,
          p_unread_only: unreadOnly,
          p_limit: pageSize,
        }),
      ]);
      if (authError || !authData.user) throw authError ?? new Error("Notification user unavailable");
      setUserId(authData.user.id);
      if (pageError) throw pageError;
      const page = notificationPageFromRows((data ?? []) as unknown as Array<Record<string, unknown>>);
      setItems((previous) => append
        ? [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))]
        : page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
    } catch (cause) {
      console.error("Notification feed load failed", cause);
      if (!append) setError("Notifications are unavailable right now.");
    } finally {
      // Keep the badge exact even when history is temporarily unavailable.
      await refreshCount();
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [pageSize, refreshCount, unreadOnly]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    void fetchPage(null, false);
  }, [fetchPage]);

  const refresh = useCallback(() => fetchPage(null, false), [fetchPage]);

  useRealtimeSubscription({
    table: "notifications",
    filter: userId ? `user_id=eq.${userId}` : undefined,
    onInsert: () => { setRealtimeError(false); void refresh(); },
    onUpdate: () => { setRealtimeError(false); void refresh(); },
    onDelete: () => { setRealtimeError(false); void refresh(); },
    onError: () => setRealtimeError(true),
    onReconnect: () => { setRealtimeError(false); void refresh(); },
    enabled: realtime && Boolean(userId),
  });

  const markRead = useCallback(async (id: string) => {
    const { error: markError } = await createClient().rpc("mark_notification_read", { p_notification_id: id });
    if (markError) throw markError;
    setItems((previous) => unreadOnly
      ? previous.filter((item) => item.id !== id)
      : previous.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
    await refreshCount();
  }, [refreshCount, unreadOnly]);

  const markAllRead = useCallback(async () => {
    const { error: markError } = await createClient().rpc("mark_all_notifications_read");
    if (markError) throw markError;
    setItems((previous) => unreadOnly ? [] : previous.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })));
    await refreshCount();
  }, [refreshCount, unreadOnly]);

  return {
    items,
    unreadCount,
    hasMore,
    loading,
    loadingMore,
    error,
    realtimeError,
    refresh,
    loadMore: () => cursor ? fetchPage(cursor, true) : undefined,
    markRead,
    markAllRead,
  };
}
