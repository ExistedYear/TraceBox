"use client";
/* eslint-disable react-hooks/set-state-in-effect */


import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Eye,
  Loader2,
  MessageSquare,
  Milestone,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeNotifications } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";

type NotificationItem = {
  id: string;
  type: string;
  data: {
    issue_number?: number;
    title?: string;
    project_key?: string;
    excerpt?: string;
  } | null;
  actor_name?: string | null;
  read_at: string | null;
  created_at: string;
};

function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function typeIcon(type: string) {
  switch (type) {
    case "ASSIGNED":
      return <UserCheck className="h-3.5 w-3.5 text-blue-400" />;
    case "COMMENT":
    case "MENTION":
      return <MessageSquare className="h-3.5 w-3.5 text-purple-400" />;
    case "STATUS_CHANGED":
      return <Check className="h-3.5 w-3.5 text-emerald-400" />;
    case "MILESTONE_CHANGED":
      return <Milestone className="h-3.5 w-3.5 text-amber-400" />;
    default:
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userId, setUserId] = useState<string>("");

  const fetchNotifications = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserId(user.id);
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, data, read_at, created_at, actor:profiles (display_name)")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!error && data) {
      const items: NotificationItem[] = data.map((row: any) => ({
        id: row.id,
        type: row.type,
        data: row.data as any,
        actor_name: row.actor?.display_name ?? null,
        read_at: row.read_at,
        created_at: row.created_at,
      }));
      setNotifications(items);
      setUnreadCount(items.filter((item) => !item.read_at).length);
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useRealtimeNotifications(userId, (payload: any) => {
    const newItem: NotificationItem = {
      id: payload.id,
      type: payload.type,
      data: payload.data,
      actor_name: null,
      read_at: payload.read_at,
      created_at: payload.created_at,
    };
    setNotifications((prev) => [newItem, ...prev].slice(0, 20));
    if (!newItem.read_at) setUnreadCount((c) => c + 1);
  });

  async function handleMarkRead(id: string) {
    try {
      await createClient().rpc("mark_notification_read", { p_notification_id: id });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      toast.error("Could not update notification.");
    }
  }

  async function handleMarkAllRead() {
    setLoading(true);
    try {
      await createClient().rpc("mark_all_notifications_read");
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })),
      );
      setUnreadCount(0);
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Could not mark all as read.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={`Notifications (${unreadCount} unread)`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0 rounded-[10px]">
        <div className="flex items-center justify-between border-b border-border/80 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide">Notifications</span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.2 font-mono text-[10px] font-medium text-primary">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={loading}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {notifications.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-start gap-3 p-3 text-xs transition-colors hover:bg-accent/40",
                    !item.read_at && "bg-primary/5",
                  )}
                >
                  <span className="mt-0.5 shrink-0">{typeIcon(item.type)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">
                      <span className="font-medium">{item.actor_name ?? "Someone"}</span>{" "}
                      <span className="text-muted-foreground">
                        {item.type === "ASSIGNED"
                          ? "assigned you to an issue"
                          : item.type === "COMMENT"
                            ? "commented on an issue"
                            : item.type === "MENTION"
                              ? "mentioned you in a comment"
                              : item.type === "STATUS_CHANGED"
                                ? "changed issue status"
                                : "updated a watched issue"}
                      </span>
                    </p>
                    {item.data?.title && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-primary">
                        {item.data.title}
                      </p>
                    )}
                    {item.data?.excerpt && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        &ldquo;{item.data.excerpt}&rdquo;
                      </p>
                    )}
                    <span className="mt-1 block font-mono text-[10px] text-muted-foreground/70">
                      {relativeTime(item.created_at)}
                    </span>
                  </div>
                  {!item.read_at && (
                    <button
                      type="button"
                      onClick={() => void handleMarkRead(item.id)}
                      title="Mark as read"
                      aria-label="Mark as read"
                      className="shrink-0 p-1 text-muted-foreground hover:text-primary"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
