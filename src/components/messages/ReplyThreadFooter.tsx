import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, formatRelativeShort, getInitials } from "../../lib/utils";
import type { ConversationMember, Message } from "../../lib/api";

const MAX_REPLIERS = 3;

/**
 * The line under a root message that has replies: who replied, how many
 * replies, when the last one landed, and a dot when the viewer has unread
 * replies. Opens the reply thread in the side pane. Only rendered with the
 * viewer's `reply_threads` flag on (ChatThread).
 */
export const ReplyThreadFooter = memo(function ReplyThreadFooter({
  message,
  isOwn,
  active,
  members,
  onOpen,
}: {
  message: Message;
  isOwn: boolean;
  /** This root's thread is the one open in the side pane. */
  active?: boolean;
  members?: ConversationMember[];
  onOpen: (rootId: string) => void;
}) {
  const { t } = useTranslation("chat");
  const count = message.replyCount ?? 0;
  if (count <= 0) return null;

  const repliers = (message.replySenderIds ?? [])
    .map((id) => members?.find((m) => m.participantId === id)?.participant)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, MAX_REPLIERS);
  const unread = (message.threadUnread ?? 0) > 0;
  const lastReply = formatRelativeShort(message.lastReplyAt ?? undefined);

  return (
    // Lines up with the bubble (MessageBubble's row is px-4 with a w-8 avatar
    // and gap-2): past the avatar column for others' messages, against the
    // right edge for the viewer's own.
    <div className={cn("flex", isOwn ? "justify-end pr-4" : "pl-14")}>
      <button
        type="button"
        onClick={() => onOpen(message.id)}
        aria-label={t("replyThread.openThread")}
        title={t("replyThread.openThread")}
        className={cn(
          "mt-0.5 flex max-w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-xs transition-colors hover:border-border hover:bg-accent/60",
          active && "border-border bg-accent/60"
        )}
      >
        {repliers.length > 0 && (
          <span className="flex -space-x-1.5">
            {repliers.map((p) => (
              <Avatar key={p.id} className="h-5 w-5 ring-1 ring-card" title={p.displayName}>
                {p.avatarUrl && <AvatarImage src={p.avatarUrl} alt={p.displayName} />}
                <AvatarFallback className="bg-primary/10 text-[8px] text-primary">
                  {p.type === "agent" ? <Bot className="h-3 w-3" /> : getInitials(p.displayName)}
                </AvatarFallback>
              </Avatar>
            ))}
          </span>
        )}
        <span className={cn("font-semibold text-primary", unread && "font-bold")}>
          {t("replyThread.replies", { count })}
        </span>
        {lastReply && <span className="text-muted-foreground">{lastReply}</span>}
        {unread && (
          <span
            role="img"
            aria-label={t("replyThread.unread")}
            title={t("replyThread.unread")}
            className="h-2 w-2 shrink-0 rounded-full bg-primary"
          />
        )}
      </button>
    </div>
  );
});
