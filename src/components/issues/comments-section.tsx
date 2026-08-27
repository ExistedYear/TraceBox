"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare, Pencil, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeComments } from "@/hooks/use-realtime";
import { buildTimeline, eventSummary, personLabel, tokenizeCommentBody, type TimelineComment, type TimelineEventRow } from "@/lib/issues";
import { commentSchema, type CommentValues } from "@/lib/validation/comment";
type Props = {
  issueId: string;
  projectKey: string;
  currentUserId: string;
  canComment: boolean;
  canEditAnyComment: boolean;
  comments: TimelineComment[];
  events: TimelineEventRow[];
  displayNames: Map<string, string>;
  componentNames: Map<string, string>;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function CommentBody({ body }: { body: string }) {
  const tokens = tokenizeCommentBody(body);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6">
      {tokens.map((token, index) => {
        if (token.kind === "mention") return <span key={index} className="rounded bg-primary/10 px-1 py-0.5 font-medium text-primary">{token.text}</span>;
        if (token.kind === "issue-ref") return <Link key={index} href={`/dashboard/issues/${token.text}`} className="font-mono text-xs font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{token.text}</Link>;
        return <span key={index}>{token.text}</span>;
      })}
    </p>
  );
}

function Composer({ issueId, currentUserId, onAdded }: { issueId: string; currentUserId: string; onAdded: (comment: TimelineComment) => void }) {
  const router = useRouter();
  const form = useForm<CommentValues>({ resolver: zodResolver(commentSchema), defaultValues: { body: "" } });
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(values: CommentValues) {
    setSubmitting(true);
    try {
      const { data, error } = await createClient().rpc("add_comment", { p_issue_id: issueId, p_body: values.body });
      if (error) {
        console.error("Comment creation failed:", error);
        const msg = String(error.message);
        toast.error(
          msg.includes("NOT_ALLOWED")
            ? "You do not have permission to comment."
            : msg.includes("PROJECT_ARCHIVED")
              ? "This project is archived."
              : msg.includes("VALIDATION")
                ? "Comment must be 1–10,000 characters."
                : msg.includes("NOT_FOUND")
                  ? "Issue not found."
                  : "Could not add comment.",
        );
        return;
      }
      const newComment: TimelineComment = {
        id: String(data),
        issue_id: issueId,
        author_id: currentUserId,
        body: values.body.trim(),
        edited_at: null,
        created_at: new Date().toISOString(),
      };
      onAdded(newComment);
      form.reset();
      toast.success("Comment added.");
      router.refresh();
    } catch (err) {
      console.error("Unexpected comment creation error:", err);
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
      <label htmlFor="comment-body" className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Write a comment</label>
      <textarea
        id="comment-body"
        rows={3}
        placeholder="Markdown supported · @mention · TRACE-123 refs are styled"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        {...form.register("body")}
      />
      {form.formState.errors.body && <p className="text-xs text-destructive">{form.formState.errors.body.message}</p>}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Supports code blocks, mentions, and issue references.</p>
        <Button type="submit" size="sm" className="h-8 gap-1.5" disabled={submitting}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Comment
        </Button>
      </div>
    </form>
  );
}

function EditableComment({
  comment,
  currentUserId,
  canEditAny,
  displayNames,
  onUpdated,
}: {
  comment: TimelineComment;
  currentUserId: string;
  canEditAny: boolean;
  displayNames: Map<string, string>;
  onUpdated: (id: string, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const isOwn = comment.author_id === currentUserId;
  const canEdit = isOwn || canEditAny;
  const authorLabel = personLabel(displayNames.get(comment.author_id) ?? null, comment.author_id);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === comment.body) {
      setEditing(false);
      setDraft(comment.body);
      return;
    }
    if (trimmed.length > 10000) {
      toast.error("Keep it under 10,000 characters.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("edit_comment", { p_comment_id: comment.id, p_body: trimmed });
      if (error) {
        console.error("Comment edit failed:", error);
        const msg = String(error.message);
        toast.error(
          msg.includes("NOT_ALLOWED")
            ? "You can only edit your own comments."
            : msg.includes("PROJECT_ARCHIVED")
              ? "This project is archived."
              : msg.includes("VALIDATION")
                ? "Comment must be 1–10,000 characters."
                : "Could not save comment.",
        );
        return;
      }
      onUpdated(comment.id, trimmed);
      setEditing(false);
      toast.success("Comment updated.");
    } catch (err) {
      console.error("Unexpected comment edit error:", err);
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[10px] border border-border/80 bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{authorLabel}</span>
        <span className="flex items-center gap-2">
          <span suppressHydrationWarning className="font-mono text-[10px] text-muted-foreground">{formatDate(comment.created_at)} · {formatTime(comment.created_at)}</span>
          {comment.edited_at && <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">edited</span>}
          {canEdit && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] hover:bg-accent" aria-label="Edit comment">
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
          {editing && (
            <button type="button" onClick={() => { setEditing(false); setDraft(comment.body); }} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] hover:bg-accent">
              <X className="h-3 w-3" /> Cancel
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea aria-label="Edit comment body" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setEditing(false); setDraft(comment.body); }}>Cancel</Button>
            <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save
            </Button>
          </div>
        </div>
      ) : (
        <CommentBody body={comment.body} />
      )}
    </div>
  );
}

export function CommentsSection({ issueId, projectKey: _projectKey, currentUserId, canComment, canEditAnyComment, comments: initialComments, events, displayNames, componentNames }: Props) {
  const router = useRouter();
  const [prevInitial, setPrevInitial] = useState(initialComments);
  const [comments, setComments] = useState<TimelineComment[]>(initialComments);

  if (initialComments !== prevInitial) {
    setPrevInitial(initialComments);
    setComments(initialComments);
  }
  const timeline = useMemo(() => buildTimeline(events, comments), [events, comments]);

  useRealtimeComments(issueId, {
    onInsert: (payload) => {
      const newComment = payload as TimelineComment;
      setComments((prev) => (prev.some((c) => c.id === newComment.id) ? prev : [...prev, newComment]));
    },
    onUpdate: (payload) => {
      const updated = payload as TimelineComment;
      setComments((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
    },
    onDelete: (payload) => {
      const deleted = payload as TimelineComment;
      setComments((prev) => prev.filter((c) => c.id !== deleted.id));
    },
  });

  function handleAdded(comment: TimelineComment) {
    // Resolve author via passed currentUserId if RPC returned empty author fetch
    const withAuthor: TimelineComment = { ...comment, author_id: comment.author_id || currentUserId };
    setComments((prev) => [...prev, withAuthor]);
    router.refresh();
  }
  function handleUpdated(id: string, body: string) {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, body, edited_at: new Date().toISOString() } : c)));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Surface>
        <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" /> Activity
            <span className="rounded-full border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{timeline.length}</span>
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">{comments.length} comments · {events.length} events</span>
        </div>

        {timeline.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No activity yet. Be the first to comment.</p>
        ) : (
          <div className="relative px-4 py-3">
            <div className="pointer-events-none absolute bottom-3 left-[22px] top-3 w-px bg-border/70" aria-hidden />
            <ul className="space-y-3">
              {timeline.map((entry) => {
                if (entry.kind === "comment") {
                  return (
                    <li key={`c-${entry.comment.id}`} className="relative pl-7">
                      <span className="absolute left-[4px] top-3 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary shadow" aria-hidden />
                      <EditableComment comment={entry.comment} currentUserId={currentUserId} canEditAny={canEditAnyComment} displayNames={displayNames} onUpdated={handleUpdated} />
                    </li>
                  );
                }
                const summary = eventSummary(entry.event, (id) => displayNames.get(id) || componentNames.get(id) || id);
                const actor = personLabel(entry.event.actor_id ? displayNames.get(entry.event.actor_id) : null, entry.event.actor_id);
                // Skip rendering raw COMMENT_ADDED as duplicate when comment card already renders; keep to show actor link.
                // We keep both: comment card is the content, event is the audit. To avoid double, hide COMMENT_ADDED heading when comment exists?
                // Instead, collapse: if COMMENT_ADDED, render a compact meta line above the comment is already handled via event timeline.
                // For unified timeline we keep both entries sorted; they will appear adjacent (event just before comment due to same timestamp ordering depends on insert order).
                // To reduce noise, render COMMENT_ADDED as minimal meta without excerpt.
                const isCommentEvent = entry.event.event_type === "COMMENT_ADDED" || entry.event.event_type === "COMMENT_EDITED";
                return (
                  <li key={`e-${entry.event.id}`} className="relative flex items-start gap-2 pl-7 text-sm">
                    <span className="absolute left-[6px] top-[9px] h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{actor}</span> <span className="text-muted-foreground">{summary.heading}</span>
                      {summary.detail && !isCommentEvent && <span className="ml-1 font-mono text-xs">{summary.detail}</span>}
                      {isCommentEvent && summary.detail && <span className="ml-1 truncate font-mono text-xs text-muted-foreground">“{summary.detail.slice(0, 80)}”</span>}
                    </span>
                    <span suppressHydrationWarning className="shrink-0 whitespace-nowrap font-mono text-[10px] text-muted-foreground/70">{formatTime(entry.at)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Surface>

      {canComment ? (
        <Surface className="p-4">
          <Composer issueId={issueId} currentUserId={currentUserId} onAdded={handleAdded} />
        </Surface>
      ) : (
        <Surface className="p-4">
          <p className="text-center text-xs text-muted-foreground">Viewers cannot comment on issues in this project.</p>
        </Surface>
      )}
    </div>
  );
}
