import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ActiveStream, ConversationMember } from "../../lib/api";
import {
  PHASE_IS_ACTIVE,
  STREAM_PHASE_FALLBACK_LABEL_KEY,
  STREAM_PHASE_LABEL_KEYS,
} from "../../lib/status-contract.generated";
import { PhaseOrb } from "../PhaseOrb";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message as MessageRow,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";

// Live bubble for an agent in the `writing` phase — the text it is about
// to post. Thinking / tool-use phases live in the ActivityDock instead, and
// so does the stop-agents button.
export function StreamingBubble({
  stream,
  members,
}: {
  stream: ActiveStream;
  members?: ConversationMember[];
}) {
  const { t } = useTranslation("chat");
  const label =
    stream.phaseDetail ??
    t(STREAM_PHASE_LABEL_KEYS[stream.phase] ?? STREAM_PHASE_FALLBACK_LABEL_KEY);
  const animated = PHASE_IS_ACTIVE[stream.phase] ?? true;
  const avatarUrl = members?.find((m) => m.participantId === stream.senderId)?.participant?.avatarUrl;

  return (
    <MessageRow className="mt-2 px-4">
      {/* self-start: the streaming bubble grows downward, so the avatar
          anchors to the top where the stream began. */}
      <MessageAvatar className="h-8 w-8 self-start bg-muted">
        <Avatar className="h-8 w-8">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={stream.senderName} />}
          <AvatarFallback className="bg-muted">
            <Bot className="h-4 w-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
      </MessageAvatar>

      <MessageContent className="w-fit max-w-[72%] gap-0">
        <MessageHeader className="mb-0.5 gap-1.5 px-0 text-[11px] font-normal">
          <span className="font-medium text-foreground">{stream.senderName}</span>
          <span className="inline-flex items-center rounded-sm border border-border px-1 py-px text-[11px] font-medium text-muted-foreground">
            {t("common:agent")}
          </span>
        </MessageHeader>

        <Bubble variant="agent" className="max-w-full">
          <BubbleContent>
            {/* Preserved thoughts from prior writing bursts in this stream.
                Same styling as live writing so prose doesn't visually shift
                when a burst transitions into a preserved thought. */}
            {stream.thoughts && stream.thoughts.length > 0 && (
              <div className="mb-1.5 space-y-1.5">
                {stream.thoughts.map((t, i) => (
                  <p key={i} className="whitespace-pre-wrap break-words">
                    {t}
                  </p>
                ))}
              </div>
            )}

            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <PhaseOrb phase={stream.phase} active={animated} className="shrink-0" />
              <span>{label}</span>
            </div>

            {stream.phase === "writing" && stream.content && (
              <p className="whitespace-pre-wrap break-words">{stream.content}</p>
            )}

            {stream.recentSteps.length > 0 && stream.phase !== "writing" && (
              <div className="mt-1 space-y-0.5">
                {stream.recentSteps.map((step, i) => (
                  <div key={i} className="text-xs text-muted-foreground/70">
                    {step}
                  </div>
                ))}
              </div>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </MessageRow>
  );
}
