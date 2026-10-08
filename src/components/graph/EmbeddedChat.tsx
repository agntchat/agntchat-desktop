import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, X } from "lucide-react";
import { ws } from "../../services/websocket";
import { useChatStore } from "../../stores/chatStore";
import { useNavStore } from "../../stores/navStore";
import { ChatThread } from "../messages/ChatThread";
import { MessageComposer } from "../messages/MessageComposer";

export const CHAT_NODE_WIDTH = 520;
export const CHAT_NODE_HEIGHT = 560;

/**
 * A conversation living inside its node (phase 3): the same thread and
 * composer the chat view uses, mounted in the card. Joining the room's
 * channel and loading its latest window happen here, and the channel is
 * left on close unless the room is also open in the chat view. Wheel and
 * drag inside the thread stay with the thread (`nowheel nodrag nopan`), so
 * scrolling messages never pans the canvas.
 */
export function EmbeddedChat({
  conversationId,
  title,
  onClose,
}: {
  conversationId: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("graph");
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const fetchMessages = useChatStore((s) => s.fetchMessages);
  const setView = useNavStore((s) => s.setView);

  useEffect(() => {
    ws.joinConversation(conversationId);
    void fetchMessages(conversationId);
    return () => {
      const { activeConversationId, activeHuddleId } = useChatStore.getState();
      if (conversationId !== activeConversationId && conversationId !== activeHuddleId) {
        ws.leaveConversation(conversationId);
      }
    };
  }, [conversationId, fetchMessages]);

  return (
    <div
      className="nowheel nodrag nopan flex flex-col overflow-hidden"
      style={{ width: CHAT_NODE_WIDTH, height: CHAT_NODE_HEIGHT }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>
        <button
          type="button"
          onClick={() => {
            setActiveConversation(conversationId);
            setView("chat");
          }}
          title={t("actions.openConversation")}
          aria-label={t("actions.openConversation")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t("closeChat")}
          aria-label={t("closeChat")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatThread conversationId={conversationId} />
      </div>
      <MessageComposer conversationId={conversationId} />
    </div>
  );
}
