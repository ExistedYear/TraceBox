"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, Eye, Loader2, MessageSquare, Milestone, Tag, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNotificationFeed } from "@/hooks/use-notification-feed";
import { notificationHref, notificationLabel, type NotificationItem } from "@/lib/notifications";
import { cn } from "@/lib/utils";

function relativeTime(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function typeIcon(type: string) {
  switch (type) {
    case "ASSIGNED": return <UserCheck className="h-3.5 w-3.5 text-blue-400" />;
    case "COMMENT":
    case "MENTION": return <MessageSquare className="h-3.5 w-3.5 text-purple-400" />;
    case "LABEL_CHANGED": return <Tag className="h-3.5 w-3.5 text-cyan-400" />;
    case "MILESTONE_CHANGED":
    case "PLANNING_CHANGED": return <Milestone className="h-3.5 w-3.5 text-amber-400" />;
    case "STATUS_CHANGED": return <Check className="h-3.5 w-3.5 text-emerald-400" />;
    default: return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

export function NotificationRow({ item, onOpen, onRead }: { item: NotificationItem; onOpen: (item: NotificationItem) => void; onRead: (id: string) => void }) {
  const href = notificationHref(item);
  return (
    <li className={cn("flex items-start gap-1 p-1 text-xs transition-colors hover:bg-accent/40", !item.read_at && "bg-primary/5")}>
      <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-start gap-3 p-2 text-left">
        <span className="mt-0.5 shrink-0">{typeIcon(item.type)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-foreground"><span className="font-medium">{item.actor_name ?? "TraceBox"}</span>{" "}<span className="text-muted-foreground">{notificationLabel(item.type)}</span></span>
          {item.data.restricted ? <span className="mt-1 block font-mono text-[10px] text-muted-foreground">Restricted issue</span> : item.project_key && item.issue_number ? <span className="mt-1 block truncate font-mono text-[10px] text-primary">{item.project_key}-{item.issue_number}{item.issue_title ? ` · ${item.issue_title}` : ""}</span> : null}
          {item.data.excerpt && !item.data.restricted ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">&ldquo;{item.data.excerpt}&rdquo;</span> : null}
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground/70">{relativeTime(item.created_at)}</span>
        </span>
        {!href && !item.data.restricted ? <span className="sr-only">No issue link available</span> : null}
      </button>
      {!item.read_at ? <button type="button" onClick={() => onRead(item.id)} title="Mark as read" aria-label="Mark as read" className="shrink-0 p-1 text-muted-foreground hover:text-primary"><Check className="h-3 w-3" /></button> : null}
    </li>
  );
}

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const feed = useNotificationFeed({ pageSize: 8, realtime: true });

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
    if (href) { setOpen(false); router.push(href); }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={`Notifications (${feed.unreadCount} unread)`}>
          <Bell className="h-4 w-4" />
          {feed.unreadCount > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground">{feed.unreadCount > 99 ? "99+" : feed.unreadCount}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-[10px] p-0">
        <div className="flex items-center justify-between border-b border-border/80 px-4 py-2.5">
          <div className="flex items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide">Notifications</span>{feed.unreadCount > 0 ? <span className="rounded-full bg-primary/15 px-1.5 py-0.2 font-mono text-[10px] font-medium text-primary">{feed.unreadCount} new</span> : null}</div>
          {feed.unreadCount > 0 ? <button type="button" onClick={() => void markAllRead()} disabled={feed.loading} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">{feed.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />} Mark all read</button> : null}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {feed.loading ? <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading notifications</div> : feed.error ? <div className="px-4 py-8 text-center text-xs text-muted-foreground"><p>{feed.error}</p><button type="button" onClick={() => void feed.refresh()} className="mt-3 text-primary hover:underline">Retry</button></div> : feed.items.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted-foreground">No notifications yet.</p> : <ul className="divide-y divide-border/70">{feed.items.map((item) => <NotificationRow key={item.id} item={item} onOpen={openNotification} onRead={(id) => void markRead(id)} />)}</ul>}
        </div>
        <div className="border-t border-border/80 px-4 py-2.5 text-center"><button type="button" onClick={() => { setOpen(false); router.push("/dashboard/notifications"); }} className="text-[11px] font-medium text-primary hover:underline">View all notifications</button></div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
