import type { Message, MessageReaction } from "../lib/api";

// Pure message-list helpers shared by chatStore and its reply-thread slice
// (replyThreadSlice.ts). Kept out of chatStore so the slice can use them
// without importing the store module back.

export const PENDING_PREFIX = "pending-";

export function msgTime(m: { insertedAt?: string }): number {
  return m.insertedAt ? new Date(m.insertedAt).getTime() : 0;
}

export function dedup(messages: Message[]): Message[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

export function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort(
    (a, b) => new Date(a.insertedAt).getTime() - new Date(b.insertedAt).getTime()
  );
}

/** A thread-only reply lives in its thread's list (replyThreadSlice), never
 *  in the main timeline. The server already leaves them out of every
 *  main-timeline read; this is the client's own guard. */
export function mainTimelineOnly(messages: Message[]): Message[] {
  return messages.some((m) => m.threadOnly) ? messages.filter((m) => !m.threadOnly) : messages;
}

/** A message's reactions after a reaction_added / reaction_removed event, or
 *  null when the event changes nothing. */
export function nextReactions(
  reactions: MessageReaction[],
  emoji: string,
  participantId: string,
  kind: "added" | "removed"
): MessageReaction[] | null {
  if (kind === "added") {
    const entry = reactions.find((r) => r.emoji === emoji);
    if (entry?.participantIds.includes(participantId)) return null;
    return entry
      ? reactions.map((r) =>
          r.emoji === emoji
            ? { ...r, participantIds: [...r.participantIds, participantId] }
            : r
        )
      : [...reactions, { emoji, participantIds: [participantId] }];
  }
  return reactions
    .map((r) =>
      r.emoji === emoji
        ? { ...r, participantIds: r.participantIds.filter((p) => p !== participantId) }
        : r
    )
    .filter((r) => r.participantIds.length > 0);
}

// --- Reply threads -----------------------------------------------------------
// A reply can be held twice: in its thread's list, and (when it also shows in
// the main timeline) in `messages`. Edits to one message — a reaction, a
// delete — go to every copy.
type ReplyThreadCopies = {
  replyThreadMessages: Record<string, Message[]>;
  replyThreadRoots: Record<string, Message>;
};

export function findReplyThreadCopy(
  s: ReplyThreadCopies,
  messageId: string
): Message | undefined {
  const root = s.replyThreadRoots[messageId];
  if (root) return root;
  for (const list of Object.values(s.replyThreadMessages)) {
    const hit = list.find((m) => m.id === messageId);
    if (hit) return hit;
  }
  return undefined;
}

/** Apply `patch` to the thread-store copies of one message (`null` from the
 *  patch removes a reply). Returns only the maps that changed, or null. */
export function patchReplyThreadCopies(
  s: ReplyThreadCopies,
  messageId: string,
  patch: (m: Message) => Message | null
): Partial<ReplyThreadCopies> | null {
  let out: Partial<ReplyThreadCopies> | null = null;

  const root = s.replyThreadRoots[messageId];
  if (root) {
    const next = patch(root);
    if (next && next !== root) {
      out = { replyThreadRoots: { ...s.replyThreadRoots, [messageId]: next } };
    }
  }

  for (const [rootId, list] of Object.entries(s.replyThreadMessages)) {
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx < 0) continue;
    const next = patch(list[idx]!);
    if (next === list[idx]) continue;
    const updated = next
      ? list.map((m, i) => (i === idx ? next : m))
      : list.filter((_, i) => i !== idx);
    out = {
      ...out,
      replyThreadMessages: {
        ...(out?.replyThreadMessages ?? s.replyThreadMessages),
        [rootId]: updated,
      },
    };
  }
  return out;
}
