export type CommentMention = {
  comment_id: string;
  user_id: string;
  display_label: string;
  mention_token?: string;
};

export type MentionCandidate = {
  userId: string;
  displayLabel: string;
  mentionToken?: string;
};

export type SelectedMention = MentionCandidate & {
  token: string;
};

/** The textarea stores a compact, unambiguous token while the database keeps the stable user id. */
export function mentionToken(displayLabel: string) {
  const compact = displayLabel
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "");
  return compact || "member";
}

function comparableLabel(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "-").toLocaleLowerCase();
}

export function isStableMentionToken(token: string, mentions: readonly CommentMention[]) {
  const label = comparableLabel(token);
  return mentions.some((mention) => comparableLabel(mention.mention_token ?? mention.display_label) === label || comparableLabel(mention.display_label) === label);
}

/** Returns the active @ query immediately before a textarea caret, if any. */
export function getMentionTrigger(value: string, caret: number) {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|[\s([{"'])@([\p{L}\p{N}._-]*)$/u.exec(beforeCaret);
  if (!match || match.index === undefined) return null;
  const atIndex = match.index + match[0].lastIndexOf("@");
  return { start: atIndex, query: match[1] };
}

/** Reuses persisted rows when opening an edit, without treating unknown @text as a recipient. */
export function selectedMentionsFromRows(body: string, rows: readonly CommentMention[]): SelectedMention[] {
  const used = new Set<number>();
  const result: SelectedMention[] = [];
  const tokenPattern = /@[\p{L}\p{N}][\p{L}\p{N}._-]*/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(body)) !== null) {
    const rowIndex = rows.findIndex((row, index) => !used.has(index) && (comparableLabel(row.mention_token ?? row.display_label) === comparableLabel(match![0]) || comparableLabel(row.display_label) === comparableLabel(match![0])));
    if (rowIndex < 0) continue;
    used.add(rowIndex);
    const row = rows[rowIndex];
    result.push({ userId: row.user_id, displayLabel: row.display_label, mentionToken: row.mention_token, token: match[0] });
  }
  return result;
}

/** Only selected identities whose exact inserted token still exists are sent to the RPC. */
export function selectedMentionIds(body: string, selections: readonly SelectedMention[]) {
  const tokens = new Set<string>();
  const tokenPattern = /@[\p{L}\p{N}][\p{L}\p{N}._-]*/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(body)) !== null) tokens.add(comparableLabel(match[0]));

  return [...new Set(selections.filter((selection) => tokens.has(comparableLabel(selection.token))).map((selection) => selection.userId))];
}

export function reconcileSelectedMentions(body: string, selections: readonly SelectedMention[]) {
  const tokens = new Set<string>();
  const tokenPattern = /@[\p{L}\p{N}][\p{L}\p{N}._-]*/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(body)) !== null) tokens.add(comparableLabel(match[0]));
  return selections.filter((selection) => tokens.has(comparableLabel(selection.token)));
}

export function normalizeMentionCandidate(row: unknown): MentionCandidate | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  const userId = typeof value.user_id === "string" ? value.user_id : typeof value.id === "string" ? value.id : null;
  const displayLabel = typeof value.display_label === "string" ? value.display_label : typeof value.label === "string" ? value.label : null;
  if (!userId || !displayLabel?.trim()) return null;
  const rawMentionToken = typeof value.mention_token === "string" ? value.mention_token.trim().replace(/^@+/, "") : "";
  return { userId, displayLabel: displayLabel.trim(), mentionToken: rawMentionToken || undefined };
}
