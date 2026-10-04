import { useAuthStore } from "../stores/authStore";
import type { Conversation, Message } from "./api";

// Reply threads: replies hang off a root message and show in a right side
// pane. Not a huddle — a huddle is a separate conversation
// (lib/huddle-selectors.ts). Mirrors web/src/lib/reply-threads.ts.

/** The viewer's `reply_threads` flag. Off → a reply is a quote, as before. */
export function useReplyThreadsEnabled(): boolean {
  return useAuthStore((s) => s.participant?.features?.reply_threads === true);
}

/** Non-hook read of the same flag, for stores and WS listeners. */
export function replyThreadsEnabled(): boolean {
  return useAuthStore.getState().participant?.features?.reply_threads === true;
}

/** The root of the thread a message belongs to (itself when top-level). */
export function replyThreadRootId(message: Message): string {
  return message.threadRootId ?? message.id;
}

/** "Also send to the conversation" starts ticked only in a DM with one
 *  agent, where a thread-only reply is easy to lose. */
export function alsoInMainDefault(conversation: Conversation | undefined): boolean {
  if (!conversation || conversation.type !== "direct") return false;
  const agents = (conversation.members ?? []).filter(
    (m) => m.participant?.type === "agent"
  );
  return agents.length === 1;
}

/** A thread counts as unread for the viewer only when they are in it: they
 *  wrote its root or have replied in it. */
export function viewerInReplyThread(root: Message | undefined, viewerId: string | undefined): boolean {
  if (!root || !viewerId) return false;
  return root.senderId === viewerId || (root.replySenderIds ?? []).includes(viewerId);
}

/** Put a reply into a thread's list (oldest first): replaces the stored copy
 *  with the same id, or the optimistic placeholder carrying its nonce, else
 *  inserts it in time order. `added` is true only for a reply the list did
 *  not hold in any form. */
export function upsertReplyThreadMessage(
  list: Message[],
  message: Message,
  pendingPrefix: string
): { list: Message[]; added: boolean } {
  const byId = list.findIndex((m) => m.id === message.id);
  if (byId !== -1) {
    const next = [...list];
    // Locally-derived state (reactions) survives a re-broadcast that omits it.
    next[byId] = { ...list[byId]!, ...message, reactions: message.reactions ?? list[byId]!.reactions };
    return { list: next, added: false };
  }

  const nonce = (message.metadata as Record<string, unknown> | undefined)?.client_nonce as
    | string
    | undefined;
  if (nonce) {
    const placeholderId = `${pendingPrefix}${nonce}`;
    if (list.some((m) => m.id === placeholderId)) {
      return {
        list: list.map((m) => (m.id === placeholderId ? message : m)),
        added: false,
      };
    }
  }

  const last = list[list.length - 1];
  const next = [...list, message];
  if (last && message.insertedAt < last.insertedAt) {
    next.sort((a, b) => new Date(a.insertedAt).getTime() - new Date(b.insertedAt).getTime());
  }
  return { list: next, added: true };
}
