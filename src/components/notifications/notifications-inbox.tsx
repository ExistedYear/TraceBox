"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { NotificationRow } from "@/components/layout/notification-center";
import { Button } from "@/components/ui/button";
import { useNotificationFeed } from "@/hooks/use-notification-feed";
import { notificationHref, type NotificationItem } from "@/lib/notifications";

export function NotificationsInbox() {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const feed = useNotificationFeed({ unreadOnly, pageSize: 25 });

  async function markRead(id: string) {
    try { await feed.markRead(id); } catch { toast.error("Could not update notification."); }
  }

  async function markAllRead() {
    try { await feed.markAllRead(); toast.success("All notifications marked as read."); }
    catch { toast.error("Could not mark all as read."); }
  }

  function openNotification(item: NotificationItem) {
    const href = notificationHref(item);
    if (!item.read_at) void markRead(item.id);
    if (href) router.push(href);
  }

  return (
    <section aria-label="Notification inbox" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Inbox</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">In-app updates from issues you follow and work on.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void feed.refresh()} disabled={feed.loading}><RefreshCw className={feed.loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh</Button>
          {feed.unreadCount > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => void markAllRead()} disabled={feed.loading}><CheckCheck className="h-3.5 w-3.5" /> Mark all read</Button> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border/80 bg-card/60 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Bell className="h-4 w-4 text-primary" /><span>{feed.unreadCount} unread</span></div>
        <div role="group" aria-label="Notification filter" className="flex rounded-md border border-border/80 p-0.5">
          <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)} className={`rounded px-3 py-1.5 text-xs ${!unreadOnly ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>All</button>
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)} className={`rounded px-3 py-1.5 text-xs ${unreadOnly ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>Unread</button>
        </div>
      </div>

      {feed.realtimeError ? <div role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">Live updates are unavailable. Refresh to check for new notifications.</div> : null}
      {feed.loading ? <div className="flex items-center justify-center rounded-[10px] border border-border/80 bg-card/50 px-4 py-16 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading notifications</div> : feed.error ? <div role="alert" className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-4 py-12 text-center"><p className="text-sm font-medium">{feed.error}</p><p className="mt-1 text-xs text-muted-foreground">Your notifications were not loaded.</p><Button type="button" variant="outline" size="sm" onClick={() => void feed.refresh()} className="mt-4">Try again</Button></div> : feed.items.length === 0 ? <div className="rounded-[10px] border border-dashed border-border/80 px-4 py-16 text-center"><Check className="mx-auto h-6 w-6 text-emerald-400" /><p className="mt-3 text-sm font-medium">{unreadOnly ? "You are all caught up" : "No notifications yet"}</p><p className="mt-1 text-xs text-muted-foreground">Updates will appear here when something needs your attention.</p></div> : <div className="overflow-hidden rounded-[10px] border border-border/80 bg-card/40"><ul className="divide-y divide-border/70">{feed.items.map((item) => <NotificationRow key={item.id} item={item} onOpen={openNotification} onRead={(id) => void markRead(id)} />)}</ul></div>}
      {!feed.loading && !feed.error && feed.hasMore ? <div className="flex justify-center"><Button type="button" variant="outline" onClick={() => void feed.loadMore()} disabled={feed.loadingMore}>{feed.loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Load older notifications</Button></div> : null}
    </section>
  );
}

