import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/authStore";
import { useChatStore } from "../stores/chatStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useStreamingStore } from "../stores/streamingStore";
import type { ConversationMember } from "../lib/api";
import {
  buildConversationActivity,
  type ActivityEntry,
} from "../lib/conversation-activity";

const NO_MEMBERS: ConversationMember[] = [];

/**
 * Who is doing something in this conversation right now — one entry per
 * participant, stable order. The single source both the chat header (counts)
 * and the thread (ActivityDock + writing bubbles) read, so they never
 * disagree. See `lib/conversation-activity.ts` for the merge rules.
 */
export function useConversationActivity(
  conversationId: string | undefined,
  members: ConversationMember[] | undefined
): ActivityEntry[] {
  const { t } = useTranslation("common");
  const myId = useAuthStore((s) => s.participant?.id);
  const streams = useStreamingStore((s) =>
    conversationId ? s.streams[conversationId] : undefined
  );
  const typingIds = usePresenceStore((s) =>
    conversationId ? s.typing[conversationId] : undefined
  );
  const typingNames = usePresenceStore((s) => s.typingNames);
  const typingTypes = usePresenceStore((s) => s.typingTypes);
  const agentActivity = usePresenceStore((s) => s.agentActivity);
  const agentActivityConvs = usePresenceStore((s) => s.agentActivityConvs);
  const lastMessageSenderId = useChatStore((s) => {
    if (!conversationId) return undefined;
    const list = s.messages[conversationId];
    return list && list.length > 0 ? list[list.length - 1].senderId : undefined;
  });
  const fallbackName = t("someone");

  return useMemo(
    () =>
      conversationId
        ? buildConversationActivity({
            conversationId,
            streams,
            typingIds,
            typingNames,
            typingTypes,
            agentActivity,
            agentActivityConvs,
            members: members ?? NO_MEMBERS,
            myId,
            lastMessageSenderId,
            fallbackName,
          })
        : [],
    [
      conversationId,
      streams,
      typingIds,
      typingNames,
      typingTypes,
      agentActivity,
      agentActivityConvs,
      members,
      myId,
      lastMessageSenderId,
      fallbackName,
    ]
  );
}
