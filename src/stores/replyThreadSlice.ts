import type { StoreApi } from "zustand";
import * as api from "../lib/api";
import type { Message } from "../lib/api";
import { track, ANALYTICS_EVENTS } from "../lib/analytics";
import { upsertReplyThreadMessage, viewerInReplyThread } from "../lib/reply-threads";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";
import { dedup, msgTime, PENDING_PREFIX, sortMessages } from "./chatMessageHelpers";
import type { ChatState } from "./chatStore";

// Reply threads — Slack-style threads under a message. Not huddles: a
// thread's replies are messages of the SAME conversation. They live here, per
// root, and never in `messages[conversationId]` unless they also show in the
// main timeline — the main-timeline merge (`applyLatestWindow`) treats a
// cached message the server's window leaves out as deleted, and the window
// never has a thread-only reply. Mirrors web's stores/chat/replyThreadSlice.ts.

export interface ReplyThreadSlice {
  /** The thread open in the right side pane. Its conversation is always
   * `activeConversationId`. Only one right pane at a time: opening a thread
   * closes an open huddle and the reverse. */
  activeReplyThread: { conversationId: string; rootId: string } | null;
  /** Replies per root id, oldest first. Roots are not in these lists. */
  replyThreadMessages: Record<string, Message[]>;
  /** The root as the thread fetch returned it, for a root the main timeline
   * has not loaded. */
  replyThreadRoots: Record<string, Message>;
  replyThreadLoading: Record<string, boolean>;
  replyThreadError: Record<string, boolean>;

  /** Show a thread in the side pane, load it and mark it read. */
  openReplyThread: (conversationId: string, rootId: string) => void;
  closeReplyThread: () => void;
  fetchReplyThread: (conversationId: string, rootId: string) => Promise<void>;
  /** Zero the root's `threadUnread` locally and tell the server. */
  markReplyThreadRead: (conversationId: string, rootId: string) => void;
  /** Send a reply into a thread. Thread-only unless `alsoInMain`. Resolves
   * false when the send failed (the optimistic reply is removed). */
  sendReplyThreadMessage: (
    conversationId: string,
    rootId: string,
    content: string,
    options?: { alsoInMain?: boolean }
  ) => Promise<boolean>;
  /** Show a thread-only reply in the main timeline too. Rejects on failure. */
  postReplyToMain: (conversationId: string, messageId: string) => Promise<void>;
  /** A reply arrived (`thread_reply`, or `new_message` for one that also
   * shows in the main timeline): file it in its thread's list when loaded and
   * keep the root's unread count. Never touches `messages`. */
  applyReplyThreadMessage: (conversationId: string, message: Message) => void;
  /** `thread_updated`: the root's footer counters changed. */
  applyReplyThreadUpdated: (
    conversationId: string,
    summary: {
      rootId: string;
      replyCount?: number;
      lastReplyAt?: string | null;
      replySenderIds?: string[];
    }
  ) => void;
}

/** Replies already counted toward a root's `threadUnread` this session, so a
 *  reply seen as `thread_reply` and later posted to the main timeline
 *  (`new_message`, same id) counts once. */
const countedReplyIds = new Set<string>();

/** Threads the viewer has opened this session. The server counts a thread as
 *  unread for anyone who has read it before; this is the client's view of
 *  the same rule for replies that arrive live. */
const openedRootIds = new Set<string>();

function nonceOf(message: Message): string | undefined {
  return (message.metadata as Record<string, unknown> | undefined)?.client_nonce as
    | string
    | undefined;
}

/** Patch a root wherever it is held: the main timeline and the thread cache. */
function patchRoot(
  s: ChatState,
  conversationId: string,
  rootId: string,
  patch: (root: Message) => Message
): Partial<ChatState> {
  const out: Partial<ChatState> = {};
  const list = s.messages[conversationId];
  const idx = list ? list.findIndex((m) => m.id === rootId) : -1;
  if (list && idx !== -1) {
    const next = [...list];
    next[idx] = patch(list[idx]!);
    out.messages = { ...s.messages, [conversationId]: next };
  }
  const cached = s.replyThreadRoots[rootId];
  if (cached) {
    out.replyThreadRoots = { ...s.replyThreadRoots, [rootId]: patch(cached) };
  }
  return out;
}

function findRoot(s: ChatState, conversationId: string, rootId: string): Message | undefined {
  return (
    s.messages[conversationId]?.find((m) => m.id === rootId) ?? s.replyThreadRoots[rootId]
  );
}

export function createReplyThreadSlice(
  set: StoreApi<ChatState>["setState"],
  get: StoreApi<ChatState>["getState"]
): ReplyThreadSlice {
  return {
    activeReplyThread: null,
    replyThreadMessages: {},
    replyThreadRoots: {},
    replyThreadLoading: {},
    replyThreadError: {},

    openReplyThread: (conversationId, rootId) => {
      // One right pane at a time: a reply thread replaces an open huddle.
      if (get().activeHuddleId) get().closeHuddle();

      set((s) => {
        // Paint the root at once when the main timeline already has it.
        const seed = s.messages[conversationId]?.find((m) => m.id === rootId);
        return {
          activeReplyThread: { conversationId, rootId },
          replyThreadRoots:
            seed && !s.replyThreadRoots[rootId]
              ? { ...s.replyThreadRoots, [rootId]: seed }
              : s.replyThreadRoots,
        };
      });
      void get().fetchReplyThread(conversationId, rootId);
    },

    closeReplyThread: () => {
      if (get().activeReplyThread) set({ activeReplyThread: null });
    },

    fetchReplyThread: async (conversationId, rootId) => {
      set((s) => ({
        replyThreadLoading: { ...s.replyThreadLoading, [rootId]: true },
        replyThreadError: { ...s.replyThreadError, [rootId]: false },
      }));
      try {
        const data = await api.fetchReplyThread(conversationId, rootId);
        set((s) => {
          const fetched = sortMessages(dedup(data.replies ?? []));
          const fetchedIds = new Set(fetched.map((m) => m.id));
          const fetchedNonces = new Set(fetched.map(nonceOf).filter(Boolean));
          const newest = fetched.length > 0 ? msgTime(fetched[fetched.length - 1]!) : 0;
          // Kept from the cache: optimistic sends still awaiting their echo,
          // and replies that arrived live after the server's snapshot.
          const kept = (s.replyThreadMessages[rootId] ?? []).filter((m) => {
            if (fetchedIds.has(m.id)) return false;
            if (m.pending) return !fetchedNonces.has(m.nonce);
            return msgTime(m) > newest;
          });
          return {
            // The root's fresh counters, wherever it is held.
            ...patchRoot(s, conversationId, rootId, (root) => ({
              ...root,
              replyCount: data.root.replyCount,
              lastReplyAt: data.root.lastReplyAt,
              replySenderIds: data.root.replySenderIds,
              threadUnread: data.root.threadUnread,
            })),
            replyThreadMessages: {
              ...s.replyThreadMessages,
              [rootId]: sortMessages([...fetched, ...kept]),
            },
            replyThreadRoots: { ...s.replyThreadRoots, [rootId]: data.root },
            replyThreadLoading: { ...s.replyThreadLoading, [rootId]: false },
          };
        });
        // Read only what is still on screen.
        if (get().activeReplyThread?.rootId === rootId) {
          get().markReplyThreadRead(conversationId, rootId);
        }
      } catch (e) {
        console.warn(`[chat] fetchReplyThread(${rootId}) failed`, e);
        set((s) => ({
          replyThreadLoading: { ...s.replyThreadLoading, [rootId]: false },
          replyThreadError: { ...s.replyThreadError, [rootId]: true },
        }));
      }
    },

    markReplyThreadRead: (conversationId, rootId) => {
      openedRootIds.add(rootId);
      set((s) =>
        patchRoot(s, conversationId, rootId, (root) =>
          (root.threadUnread ?? 0) === 0 ? root : { ...root, threadUnread: 0 }
        )
      );
      api
        .markReplyThreadReadRest(conversationId, rootId)
        .catch((e) => console.warn("[chat] reply-thread mark-read failed", rootId, e));
    },

    sendReplyThreadMessage: async (conversationId, rootId, content, options) => {
      const alsoInMain = options?.alsoInMain === true;
      const nonce = crypto.randomUUID();
      const participant = useAuthStore.getState().participant;
      const now = new Date().toISOString();
      // The optimistic reply goes into the thread's list only. One that also
      // shows in the main timeline is added there when the server echoes it
      // (`new_message`), not before.
      const placeholder: Message = {
        id: `${PENDING_PREFIX}${nonce}`,
        conversationId,
        senderId: participant?.id ?? "",
        sender: participant
          ? {
              id: participant.id,
              type: "human",
              displayName: participant.displayName,
              avatarUrl: participant.avatarUrl,
            }
          : undefined,
        content,
        messageType: "text",
        threadRootId: rootId,
        threadOnly: !alsoInMain,
        insertedAt: now,
        updatedAt: now,
        pending: true,
        nonce,
        metadata: { client_nonce: nonce },
      };

      set((s) => ({
        replyThreadMessages: {
          ...s.replyThreadMessages,
          [rootId]: [...(s.replyThreadMessages[rootId] ?? []), placeholder],
        },
      }));

      try {
        await ws.sendMessage(conversationId, content, {
          metadata: { client_nonce: nonce },
          threadRootId: rootId,
          alsoInMain,
        });
        // Properties only — never message content.
        track(ANALYTICS_EVENTS.MESSAGE_SENT, {
          has_attachments: false,
          is_reply: true,
          conversation_kind: get().getConversation(conversationId)?.type ?? null,
        });
        return true;
      } catch (e) {
        console.warn("[chat] sendReplyThreadMessage failed, removing placeholder", e);
        set((s) => ({
          replyThreadMessages: {
            ...s.replyThreadMessages,
            [rootId]: (s.replyThreadMessages[rootId] ?? []).filter(
              (m) => m.id !== placeholder.id
            ),
          },
        }));
        return false;
      }
    },

    postReplyToMain: async (conversationId, messageId) => {
      const message = await api.postReplyToMainRest(conversationId, messageId);
      // The channel's `new_message` does the same; whichever lands second is
      // a no-op (both paths dedupe by id).
      countedReplyIds.add(message.id);
      get().applyReplyThreadMessage(conversationId, message);
      get().addMessage(conversationId, message);
    },

    applyReplyThreadMessage: (conversationId, message) => {
      const rootId = message.threadRootId;
      if (!rootId) return;
      const viewerId = useAuthStore.getState().participant?.id;
      const isOpen = get().activeReplyThread?.rootId === rootId;
      let unreadForOpenThread = false;

      set((s) => {
        const out: Partial<ChatState> = {};

        // 1. The thread's list, when it is loaded.
        const list = s.replyThreadMessages[rootId];
        if (list) {
          const { list: next } = upsertReplyThreadMessage(list, message, PENDING_PREFIX);
          out.replyThreadMessages = { ...s.replyThreadMessages, [rootId]: next };
        }

        // 2. The root's unread count: a reply by someone else, not seen
        //    before, in a thread the viewer is in.
        const root = findRoot(s, conversationId, rootId);
        const alreadyCounted = countedReplyIds.has(message.id);
        countedReplyIds.add(message.id);
        // Older than the thread's newest reply: not a new reply but an old
        // one being posted to the main timeline.
        const stale =
          !!root?.lastReplyAt && msgTime(message) < new Date(root.lastReplyAt).getTime();
        const fromOther = !!viewerId && message.senderId !== viewerId;
        const inThread =
          viewerInReplyThread(root, viewerId) ||
          openedRootIds.has(rootId) ||
          (root?.threadUnread ?? 0) > 0;

        if (fromOther && !alreadyCounted && !stale && inThread) {
          if (isOpen) {
            unreadForOpenThread = true;
          } else {
            Object.assign(
              out,
              patchRoot(s, conversationId, rootId, (r) => ({
                ...r,
                threadUnread: (r.threadUnread ?? 0) + 1,
              }))
            );
          }
        }

        return Object.keys(out).length > 0 ? out : s;
      });

      // Read as it arrives while the thread is on screen.
      if (isOpen && unreadForOpenThread) get().markReplyThreadRead(conversationId, rootId);
    },

    applyReplyThreadUpdated: (conversationId, summary) => {
      set((s) => {
        const out = patchRoot(s, conversationId, summary.rootId, (root) => ({
          ...root,
          replyCount: summary.replyCount ?? root.replyCount,
          lastReplyAt:
            summary.lastReplyAt !== undefined ? summary.lastReplyAt : root.lastReplyAt,
          replySenderIds: summary.replySenderIds ?? root.replySenderIds,
        }));
        return Object.keys(out).length > 0 ? out : s;
      });
    },
  };
}
