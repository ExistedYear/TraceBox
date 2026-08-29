"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Loader2, MessageSquare, Pencil, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Surface } from "@/components/tracebox/primitives";
import { MarkdownContent } from "@/components/tracebox/markdown-content";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeComments } from "@/hooks/use-realtime";
import { buildTimeline, eventSummary, personLabel, type TimelineComment, type TimelineEventRow } from "@/lib/issues";
import { getMentionTrigger, mentionToken, normalizeMentionCandidate, reconcileSelectedMentions, selectedMentionIds, selectedMentionsFromRows, type CommentMention, type MentionCandidate, type SelectedMention } from "@/lib/comment-mentions";
import { commentSchema, type CommentValues } from "@/lib/validation/comment";
type Props = {
  issueId: string;
  projectId: string;
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

async function loadCommentMentions(commentId: string): Promise<CommentMention[]> {
  try {
    const { data, error } = await createClient().from("comment_mentions").select("comment_id, user_id, display_label, mention_token").eq("comment_id", commentId);
    if (error) {
      console.error("Comment mention lookup failed:", error);
      return [];
    }
    return data as CommentMention[];
  } catch (error) {
    console.error("Comment mention request failed:", error);
    return [];
  }
}

function CommentBody({ body, mentions }: { body: string; mentions?: readonly CommentMention[] }) {
  return <MarkdownContent body={body} mentions={mentions ?? []} />;
}

function MentionTextarea({
  id,
  issueId,
  projectId,
  value,
  onChange,
  selections,
  onSelectionsChange,
  "aria-label": ariaLabel,
  placeholder,
  rows = 3,
}: {
  id?: string;
  issueId: string;
  projectId: string;
  value: string;
  onChange: (value: string) => void;
  selections: SelectedMention[];
  onSelectionsChange: (selections: SelectedMention[]) => void;
  "aria-label"?: string;
  placeholder?: string;
  rows?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef(0);
  const [caret, setCaret] = useState(0);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useMemo(() => getMentionTrigger(value, caret), [value, caret]);

  useEffect(() => {
    if (!trigger) {
      requestRef.current += 1;
      return;
    }
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      setCandidates([]);
      setActiveIndex(0);
      try {
        const { data, error: rpcError } = await createClient().rpc("list_project_mention_candidates", {
          p_project_id: projectId,
          p_issue_id: issueId,
          p_query: trigger.query,
          p_limit: 8,
        });
        if (requestId !== requestRef.current) return;
        if (rpcError) throw rpcError;
        const normalized = (Array.isArray(data) ? data : [])
          .map(normalizeMentionCandidate)
          .filter((candidate): candidate is MentionCandidate => Boolean(candidate));
        setCandidates(normalized);
      } catch (err) {
        if (requestId !== requestRef.current) return;
        console.error("Mention candidate lookup failed:", err);
        setError(true);
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [issueId, projectId, trigger]);

  function updateCaret(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? value.length);
  }

  function selectCandidate(candidate: MentionCandidate) {
    if (!trigger) return;
    const token = `@${candidate.mentionToken ?? mentionToken(candidate.displayLabel)}`;
    const replacement = `${token} `;
    const nextValue = `${value.slice(0, trigger.start)}${replacement}${value.slice(caret)}`;
    onChange(nextValue);
    onSelectionsChange([
      ...selections.filter((selection) => selection.token.toLocaleLowerCase() !== token.toLocaleLowerCase()),
      { ...candidate, token },
    ]);
    setOpen(false);
    const nextCaret = trigger.start + replacement.length;
    window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (event.key === "ArrowDown" && candidates.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % candidates.length);
    } else if (event.key === "ArrowUp" && candidates.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
    } else if (event.key === "Enter" && candidates[activeIndex]) {
      event.preventDefault();
      selectCandidate(candidates[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={id}
        rows={rows}
        value={value}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={open && candidates.length > 0 ? `${id ?? "comment"}-mention-list` : undefined}
        aria-activedescendant={open && candidates[activeIndex] ? `${id ?? "comment"}-mention-${activeIndex}` : undefined}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextTrigger = getMentionTrigger(nextValue, event.target.selectionStart ?? nextValue.length);
          onChange(nextValue);
          updateCaret(event.target);
          setOpen(Boolean(nextTrigger));
          setLoading(Boolean(nextTrigger));
          setError(false);
          setCandidates([]);
        }}
        onClick={(event) => updateCaret(event.currentTarget)}
        onKeyUp={(event) => updateCaret(event.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-[10px] border border-border/80 bg-popover shadow-lg" role="presentation">
          <div className="flex items-center gap-1.5 border-b border-border/70 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <AtSign className="h-3 w-3" /> Project members
            <span className="ml-auto normal-case tracking-normal">↑↓ navigate · Enter select</span>
          </div>
          <div aria-live="polite" className="sr-only">
            {loading ? "Loading project members" : error ? "Could not load project members" : candidates.length === 0 ? "No matching project members" : `${candidates.length} project members available`}
          </div>
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching members…</p>
          ) : error ? (
            <p className="px-3 py-3 text-xs text-destructive">Member search unavailable. Keep typing or try again.</p>
          ) : candidates.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">No project members match “{trigger?.query}”.</p>
          ) : (
            <ul id={`${id ?? "comment"}-mention-list`} role="listbox" aria-label="Project member suggestions" className="max-h-56 overflow-y-auto p-1">
              {candidates.map((candidate, index) => {
                const token = `@${candidate.mentionToken ?? mentionToken(candidate.displayLabel)}`;
                return (
                  <li key={candidate.userId} id={`${id ?? "comment"}-mention-${index}`} role="option" aria-selected={index === activeIndex}>
                    <button type="button" className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/70"}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCandidate(candidate)}>
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted font-mono text-[10px] text-muted-foreground"><AtSign className="h-3 w-3" /></span>
                      <span className="min-w-0 flex-1 truncate font-medium">{candidate.displayLabel}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{token}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Composer({ issueId, projectId, currentUserId, onAdded }: { issueId: string; projectId: string; currentUserId: string; onAdded: (comment: TimelineComment) => void }) {
  const router = useRouter();
  const form = useForm<CommentValues>({ resolver: zodResolver(commentSchema), defaultValues: { body: "" } });
  const [submitting, setSubmitting] = useState(false);
  const [selections, setSelections] = useState<SelectedMention[]>([]);
  const [body, setBody] = useState("");

  async function onSubmit(values: CommentValues) {
    setSubmitting(true);
    try {
      const mentionedUserIds = selectedMentionIds(values.body, selections);
      const { data, error } = await createClient().rpc("add_comment_with_mentions", { p_issue_id: issueId, p_body: values.body, p_mentioned_user_ids: mentionedUserIds });
      if (error) {
        console.error("Comment creation failed:", error);
        const msg = String(error.message);
        toast.error(
          msg.includes("NOT_ALLOWED")
            ? "You do not have permission to comment."
            : msg.includes("PROJECT_ARCHIVED")
              ? "This project is archived."
              : msg.includes("Mention recipient") || msg.includes("selected mention")
                ? "Choose mentions from the member suggestions and keep their inserted tokens in the comment."
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
        mentions: selections.filter((selection) => mentionedUserIds.includes(selection.userId)).map((selection) => ({ comment_id: String(data), user_id: selection.userId, display_label: selection.displayLabel, mention_token: selection.mentionToken ?? mentionToken(selection.displayLabel) })),
      };
      onAdded(newComment);
      form.reset();
      setBody("");
      setSelections([]);
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
      <MentionTextarea id="comment-body" issueId={issueId} projectId={projectId} value={body} onChange={(value) => { setBody(value); setSelections((current) => reconcileSelectedMentions(value, current)); form.setValue("body", value, { shouldDirty: true, shouldValidate: true }); }} selections={selections} onSelectionsChange={setSelections} aria-label="Comment body" placeholder="leave a comment... (@mention, KEY-123 supported)" />
      {form.formState.errors.body && <p className="text-xs text-destructive">{form.formState.errors.body.message}</p>}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">Markdown, @mentions, and issue references are supported.</p>
        <Button type="submit" size="sm" className="h-8 gap-1.5" disabled={submitting}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Comment
        </Button>
      </div>
    </form>
  );
}

function EditableComment({
  comment,
  projectId,
  currentUserId,
  canEditAny,
  displayNames,
  onUpdated,
}: {
  comment: TimelineComment;
  projectId: string;
  currentUserId: string;
  canEditAny: boolean;
  displayNames: Map<string, string>;
  onUpdated: (id: string, body: string, mentions: CommentMention[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [selections, setSelections] = useState<SelectedMention[]>([]);
  const isOwn = comment.author_id === currentUserId;
  const canEdit = isOwn || canEditAny;
  const authorLabel = personLabel(displayNames.get(comment.author_id) ?? null, comment.author_id);

  function beginEditing() {
    setDraft(comment.body);
    setSelections(selectedMentionsFromRows(comment.body, comment.mentions ?? []));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft(comment.body);
    setSelections([]);
  }

  async function save() {
    const trimmed = draft.trim();
    const mentionedUserIds = selectedMentionIds(trimmed, selections);
    const persistedMentionIds = [...new Set((comment.mentions ?? []).map((mention) => mention.user_id))].sort();
    const mentionsChanged = [...mentionedUserIds].sort().join(",") !== persistedMentionIds.join(",");
    if (!trimmed || (trimmed === comment.body && !mentionsChanged)) {
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
      const { error } = await createClient().rpc("edit_comment_with_mentions", { p_comment_id: comment.id, p_body: trimmed, p_mentioned_user_ids: mentionedUserIds });
      if (error) {
        console.error("Comment edit failed:", error);
        const msg = String(error.message);
        toast.error(
          msg.includes("NOT_ALLOWED")
            ? "You can only edit your own comments."
            : msg.includes("PROJECT_ARCHIVED")
              ? "This project is archived."
              : msg.includes("Mention recipient") || msg.includes("selected mention")
                ? "Choose mentions from the member suggestions and keep their inserted tokens in the comment."
              : msg.includes("VALIDATION")
                ? "Comment must be 1–10,000 characters."
                : "Could not save comment.",
        );
        return;
      }
      onUpdated(comment.id, trimmed, selections.filter((selection) => mentionedUserIds.includes(selection.userId)).map((selection) => ({ comment_id: comment.id, user_id: selection.userId, display_label: selection.displayLabel, mention_token: selection.mentionToken ?? mentionToken(selection.displayLabel) })));
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
            <button type="button" onClick={beginEditing} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] hover:bg-accent" aria-label="Edit comment">
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
          {editing && (
            <button type="button" onClick={cancelEditing} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] hover:bg-accent">
              <X className="h-3 w-3" /> Cancel
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <MentionTextarea issueId={comment.issue_id} projectId={projectId} value={draft} onChange={(value) => { setDraft(value); setSelections((current) => reconcileSelectedMentions(value, current)); }} selections={selections} onSelectionsChange={setSelections} aria-label="Edit comment body" placeholder="Edit comment… (@mention, KEY-123 supported)" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={cancelEditing}>Cancel</Button>
            <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save
            </Button>
          </div>
        </div>
      ) : (
        <CommentBody body={comment.body} mentions={comment.mentions} />
      )}
    </div>
  );
}

export function CommentsSection({ issueId, projectId, projectKey: _projectKey, currentUserId, canComment, canEditAnyComment, comments: initialComments, events, displayNames, componentNames }: Props) {
  const router = useRouter();
  const [comments, setComments] = useState<TimelineComment[]>(initialComments);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setComments(initialComments);
    });
    return () => { active = false; };
  }, [initialComments]);
  const timeline = useMemo(() => buildTimeline(events, comments), [events, comments]);

  useRealtimeComments(issueId, {
    onInsert: (payload) => {
      const newComment = payload as TimelineComment;
      void loadCommentMentions(newComment.id).then((mentions) => {
        setComments((prev) => {
          const existing = prev.find((comment) => comment.id === newComment.id);
          if (existing) return prev.map((comment) => comment.id === newComment.id ? { ...comment, ...newComment, mentions: newComment.mentions ?? (mentions.length ? mentions : comment.mentions) } : comment);
          return [...prev, { ...newComment, mentions }];
        });
      });
    },
    onUpdate: (payload) => {
      const updated = payload as TimelineComment;
      void loadCommentMentions(updated.id).then((mentions) => {
        setComments((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated, mentions: updated.mentions ?? mentions } : c)));
      });
    },
    onDelete: (payload) => {
      const deleted = payload as TimelineComment;
      setComments((prev) => prev.filter((c) => c.id !== deleted.id));
    },
    onError: () => toast.error("Live comment updates are unavailable. Refresh to see new activity."),
  });

  function handleAdded(comment: TimelineComment) {
    // Resolve author via passed currentUserId if RPC returned empty author fetch
    const withAuthor: TimelineComment = { ...comment, author_id: comment.author_id || currentUserId };
    setComments((prev) => prev.some((existing) => existing.id === withAuthor.id)
      ? prev.map((existing) => existing.id === withAuthor.id ? { ...existing, ...withAuthor } : existing)
      : [...prev, withAuthor]);
    router.refresh();
  }
  function handleUpdated(id: string, body: string, mentions: CommentMention[]) {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, body, mentions, edited_at: new Date().toISOString() } : c)));
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
                      <EditableComment comment={entry.comment} projectId={projectId} currentUserId={currentUserId} canEditAny={canEditAnyComment} displayNames={displayNames} onUpdated={handleUpdated} />
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
          <Composer issueId={issueId} projectId={projectId} currentUserId={currentUserId} onAdded={handleAdded} />
        </Surface>
      ) : (
        <Surface className="p-4">
          <p className="text-center text-xs text-muted-foreground">Viewers cannot comment on issues in this project.</p>
        </Surface>
      )}
    </div>
  );
}
