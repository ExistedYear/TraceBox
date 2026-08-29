"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";

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
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [realtimeError, setRealtimeError] = useState(false);
  const requestSequence = useRef(0);
  const countSequence = useRef(0);

  const refreshCount = useCallback(async () => {
    const sequence = ++countSequence.current;
    try {
      const { data, error: countError } = await createClient().rpc("get_unread_notifications_count");
      if (sequence !== countSequence.current) return;
      if (countError || typeof data !== "number") {
        console.error("Unread notification count failed", countError ?? { message: "invalid response" });
        return;
      }
      setUnreadCount(data);
    } catch (error) {
      if (sequence === countSequence.current) console.error("Unread notification count request failed", error);
    }
  }, []);

  const fetchPage = useCallback(async (nextCursor: NotificationCursor | null, append: boolean) => {
    const sequence = ++requestSequence.current;
    if (append) {
      setLoadingMore(true);
      setLoadMoreError(false);
    }
    else {
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      setLoadMoreError(false);
    }
    try {
      const supabase = createClient();
      const [{ data: authData, error: authError }, { data, error: pageError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("list_notifications", {
          p_cursor_created_at: nextCursor?.createdAt,
          p_cursor_id: nextCursor?.id,
          p_unread_only: unreadOnly,
          p_limit: pageSize,
        }),
      ]);
      if (authError || !authData.user) throw authError ?? new Error("Notification user unavailable");
      if (sequence !== requestSequence.current) return;
      setUserId(authData.user.id);
      if (pageError) throw pageError;
      const page = notificationPageFromRows((data ?? []) as unknown as Array<Record<string, unknown>>);
      if (sequence !== requestSequence.current) return;
      setItems((previous) => append
        ? [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))]
        : page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      console.error("Notification feed load failed", cause);
      if (append) setLoadMoreError(true);
      else setError("Notifications are unavailable right now.");
    } finally {
      if (sequence !== requestSequence.current) return;
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
    return () => {
      requestSequence.current += 1;
      countSequence.current += 1;
    };
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
    loadMoreError,
    markRead,
    markAllRead,
  };
}
