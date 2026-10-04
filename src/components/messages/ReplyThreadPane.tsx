import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CornerUpLeft, Loader2, SendHorizontal, X } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { useRightPaneWidth } from "../../hooks/useResizableWidth";
import { alsoInMainDefault } from "../../lib/reply-threads";
import { cn } from "../../lib/utils";
import type { Conversation, Message } from "../../lib/api";
import { ResizeHandle } from "../ResizeHandle";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { MessageBubble } from "./MessageBubble";
import { MessageContextMenu } from "./MessageContextMenu";
import { isStatusUpdateMessage } from "./StatusUpdateMessage";
import { isTaskMessage } from "./TaskMessages";

// Within this many px of the bottom counts as "at the bottom": a reply that
// arrives then scrolls into view; further up, the reader is left alone.
const PIN_BAND_PX = 24;
// Same sender-run break as the main timeline (ChatThread).
const SENDER_RUN_BREAK_MS = 2 * 60 * 1000;

function isCard(message: Message): boolean {
  return isTaskMessage(message) || isStatusUpdateMessage(message);
}

/**
 * The reply-thread side pane: the root message, its replies and a text-only
 * composer. Sits in the right-pane slot the huddle pane and the details pane
 * use (MessagesView), sharing their width. The thread's replies come from the
 * chat store's reply-thread slice, never from the main timeline's list.
 */
export function ReplyThreadPane({
  conversation,
  rootId,
}: {
  conversation: Conversation;
  rootId: string;
}) {
  const { t } = useTranslation("chat");
  const conversationId = conversation.id;
  const { width, ref: paneRef, resizing, onResizeStart, onResizeReset } = useRightPaneWidth();

  const viewerId = useAuthStore((s) => s.participant?.id);
  // The main timeline's copy of the root is the live one (reactions, edits);
  // the thread fetch's copy covers a root that is not loaded there.
  const root = useChatStore(
    (s) => s.messages[conversationId]?.find((m) => m.id === rootId) ?? s.replyThreadRoots[rootId]
  );
  const replies = useChatStore((s) => s.replyThreadMessages[rootId]);
  const loading = useChatStore((s) => s.replyThreadLoading[rootId] ?? false);
  const error = useChatStore((s) => s.replyThreadError[rootId] ?? false);
  // A fresh object on every open — re-focuses the composer when Reply is
  // pressed for the thread that is already showing.
  const activeReplyThread = useChatStore((s) => s.activeReplyThread);
  const closeReplyThread = useChatStore((s) => s.closeReplyThread);
  const fetchReplyThread = useChatStore((s) => s.fetchReplyThread);
  const sendReplyThreadMessage = useChatStore((s) => s.sendReplyThreadMessage);
  const postReplyToMain = useChatStore((s) => s.postReplyToMain);

  // The server allows posting a reply back to its author and to conversation
  // admins; offer it to exactly those.
  const isAdmin =
    conversation.members?.some((m) => m.participantId === viewerId && m.role === "admin") ??
    false;

  // Per thread, for as long as the pane stays mounted: the draft and the
  // "also send to the conversation" choice.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [alsoInMainChoice, setAlsoInMainChoice] = useState<Record<string, boolean>>({});
  const draft = drafts[rootId] ?? "";
  const alsoInMain = alsoInMainChoice[rootId] ?? alsoInMainDefault(conversation);
  const [sendFailed, setSendFailed] = useState(false);
  const [postFailed, setPostFailed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ message: Message; x: number; y: number } | null>(
    null
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);

  const snapToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // A newly opened thread starts at its newest reply.
  useLayoutEffect(() => {
    atBottomRef.current = true;
    setSendFailed(false);
    setPostFailed(false);
  }, [rootId]);

  const replyCount = replies?.length ?? 0;
  const lastReplyId = replies?.[replyCount - 1]?.id;
  useEffect(() => {
    if (atBottomRef.current) snapToBottom();
  }, [rootId, replyCount, lastReplyId, loading, snapToBottom]);

  // Cards and images settle their height after the first paint.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) snapToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [snapToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_BAND_PX;
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeReplyThread]);

  // Grow the composer with its text, up to a few lines.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  const setDraft = useCallback(
    (text: string) => setDrafts((d) => ({ ...d, [rootId]: text })),
    [rootId]
  );

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setSendFailed(false);
    atBottomRef.current = true;
    const ok = await sendReplyThreadMessage(conversationId, rootId, text, { alsoInMain });
    if (!ok) {
      setSendFailed(true);
      // Give the text back unless the user has already typed something new.
      setDrafts((d) => (d[rootId] ? d : { ...d, [rootId]: text }));
    }
  }, [draft, setDraft, sendReplyThreadMessage, conversationId, rootId, alsoInMain]);

  const handlePostToMain = useCallback(
    (message: Message) => {
      setPostFailed(false);
      postReplyToMain(conversationId, message.id).catch(() => setPostFailed(true));
    },
    [postReplyToMain, conversationId]
  );

  const canPostToMain = useCallback(
    (message: Message) =>
      message.threadOnly === true &&
      !message.pending &&
      (message.senderId === viewerId || isAdmin),
    [viewerId, isAdmin]
  );

  const handleContextMenu = useCallback((message: Message, e: React.MouseEvent) => {
    setContextMenu({ message, x: e.clientX, y: e.clientY });
  }, []);

  // Once loaded, count what is listed (sent replies only); before that, the
  // root's own counter.
  const shownCount = replies
    ? replies.filter((m) => !m.pending).length
    : root?.replyCount ?? 0;

  return (
    <>
      <ResizeHandle
        right={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label={t("replyThread.resizePane")}
      />
      <aside
        ref={paneRef}
        aria-label={t("replyThread.title")}
        className="surface-panel-strong relative z-20 -ml-3 flex h-full shrink-0 flex-col overflow-hidden rounded-l-lg bg-card"
        style={{ width } as React.CSSProperties}
        onKeyDown={(e) => {
          // Escape closes the pane when focus is inside it — unless it is
          // dismissing the message menu.
          if (e.key === "Escape" && !contextMenu) {
            e.stopPropagation();
            closeReplyThread();
          }
        }}
      >
        <header
          className="relative flex h-14 shrink-0 items-center gap-3 bg-card px-4 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {t("replyThread.title")}
          </h2>
          <button
            type="button"
            onClick={closeReplyThread}
            title={t("replyThread.closePane")}
            aria-label={t("replyThread.closePane")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ overflowAnchor: "none" }}
          className="min-h-0 flex-1 overflow-y-auto py-2 scrollbar-autohide"
        >
          <div ref={contentRef}>
            {root && <MessageBubble message={root} showAvatar showSenderName />}

            <Marker variant="separator" className="px-4 py-3">
              <MarkerContent className="px-1 text-[10px] font-semibold uppercase tracking-wider">
                {shownCount > 0
                  ? t("replyThread.replies", { count: shownCount })
                  : t("replyThread.noReplies")}
              </MarkerContent>
            </Marker>

            {!replies && loading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!replies && error && (
              <div
                role="alert"
                className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground"
              >
                <span>{t("replyThread.loadFailed")}</span>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent"
                  onClick={() => void fetchReplyThread(conversationId, rootId)}
                >
                  {t("common:retry")}
                </button>
              </div>
            )}

            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label={t("messagesLabel")}
            >
              {(replies ?? []).map((msg, i) => {
                const prev = replies?.[i - 1];
                const showSender =
                  !prev ||
                  prev.senderId !== msg.senderId ||
                  new Date(msg.insertedAt).getTime() - new Date(prev.insertedAt).getTime() >=
                    SENDER_RUN_BREAK_MS ||
                  isCard(prev) !== isCard(msg);
                const isOwn = msg.senderId === viewerId;
                const inMain = msg.threadOnly === false && !msg.pending;

                return (
                  <div key={msg.id} data-msg-id={msg.id}>
                    <MessageBubble
                      message={msg}
                      showAvatar={showSender}
                      showSenderName={showSender}
                      onContextMenu={handleContextMenu}
                      hideQuoteOf={rootId}
                    />
                    {(inMain || canPostToMain(msg)) && (
                      <div
                        className={cn(
                          "flex text-[10px] text-muted-foreground",
                          isOwn ? "justify-end pr-5" : "pl-[60px]"
                        )}
                      >
                        {inMain ? (
                          <span>{t("replyThread.alsoInMainLabel")}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handlePostToMain(msg)}
                            aria-label={t("replyThread.postToMain")}
                            className="flex items-center gap-1 rounded-sm font-medium hover:text-foreground hover:underline"
                          >
                            <CornerUpLeft className="h-2.5 w-2.5" aria-hidden />
                            {t("replyThread.postToMain")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="surface-dock relative z-10 bg-card p-3">
          {(sendFailed || postFailed) && (
            <p role="alert" className="mb-2 px-1 text-xs text-destructive">
              {sendFailed ? t("replyThread.sendFailed") : t("replyThread.postToMainFailed")}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline. Not while an IME is
                // composing — that Enter confirms the candidate.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={t("replyThread.composerPlaceholder")}
              aria-label={t("replyThread.composerPlaceholder")}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-xl"
              onClick={() => void handleSend()}
              disabled={!draft.trim()}
              aria-label={t("common:send")}
              title={t("common:send")}
            >
              <SendHorizontal className="h-4 w-4" />
            </Button>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary"
              checked={alsoInMain}
              onChange={(e) =>
                setAlsoInMainChoice((c) => ({ ...c, [rootId]: e.target.checked }))
              }
            />
            {t("replyThread.alsoSendToConversation")}
          </label>
        </div>

        {contextMenu && (
          <MessageContextMenu
            message={contextMenu.message}
            x={contextMenu.x}
            y={contextMenu.y}
            canDelete={false}
            onCopy={(m) => navigator.clipboard?.writeText(m.content ?? "")}
            onCopyId={(m) => navigator.clipboard?.writeText(m.id)}
            onPostToMain={canPostToMain(contextMenu.message) ? handlePostToMain : undefined}
            onClose={() => setContextMenu(null)}
          />
        )}
      </aside>
    </>
  );
}
