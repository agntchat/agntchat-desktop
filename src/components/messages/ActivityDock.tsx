import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Check, ChevronDown, Loader2, Square, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PhaseOrb } from "../PhaseOrb";
import { cn } from "../../lib/utils";
import type { ConversationMember } from "../../lib/api";
import {
  ACTIVITY_DOCK_COLLAPSE_THRESHOLD,
  PHASE_IS_ACTIVE,
  STREAM_PHASE_FALLBACK_LABEL_KEY,
  STREAM_PHASE_LABEL_KEYS,
} from "../../lib/status-contract.generated";
import { activityLabelKey, type AgentActivity } from "../../lib/agent-activity";
import { countActivity, type ActivityEntry } from "../../lib/conversation-activity";

/**
 * The activity dock: pinned between the thread and the composer, one row per
 * participant currently streaming, working, or typing in this conversation
 * (see `lib/conversation-activity.ts` for how the rows are built). Rows keep
 * their order while active and read "Done" briefly before leaving. Past
 * `ACTIVITY_DOCK_COLLAPSE_THRESHOLD` rows it folds to avatar chips behind a
 * summary line the user can expand. Agents in the `writing` phase ALSO get a
 * live bubble in the thread (`StreamingBubble`) — the dock row stays so the
 * roster and the counts stay truthful.
 *
 * Kept in parity with web `components/ActivityDock.tsx` and mobile
 * `components/ActivityDock.tsx`.
 */
export function ActivityDock({
  entries,
  members,
  onStop,
  stopping,
}: {
  entries: ActivityEntry[];
  members?: ConversationMember[];
  /** When set (and an agent is active), renders a stop button. Stops ALL
   *  agents in the conversation (server semantics of /stop-agents). */
  onStop?: () => void;
  stopping?: boolean;
}) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;

  const counts = countActivity(entries);
  const overflow = entries.length > ACTIVITY_DOCK_COLLAPSE_THRESHOLD;
  const collapsed = overflow && !expanded;
  const anyAgentActive = entries.some((e) => e.type === "agent" && !e.done);
  const avatarOf = (pid: string) =>
    members?.find((m) => m.participantId === pid)?.participant?.avatarUrl;

  const summary = [
    counts.working > 0 && t("activityDock.working", { count: counts.working }),
    counts.typing > 0 && t("activityDock.typing", { count: counts.typing }),
    counts.done > 0 && t("activityDock.done", { count: counts.done }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label={t("activityDock.label")}
      className="relative border-t border-border bg-card/80 backdrop-blur"
    >
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/60"
        >
          <span className="flex">
            {entries.slice(0, 6).map((e, i) => (
              <EntryAvatar
                key={e.participantId}
                entry={e}
                avatarUrl={avatarOf(e.participantId)}
                className={cn("ring-2 ring-card", i > 0 && "-ml-1.5")}
              />
            ))}
          </span>
          <span className="font-medium text-foreground">{summary}</span>
          <span>{collapsed ? t("activityDock.showAll") : t("activityDock.showLess")}</span>
          <ChevronDown
            className={cn(
              "ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
              !collapsed && "rotate-180",
              onStop && anyAgentActive && "mr-8"
            )}
          />
        </button>
      )}

      {collapsed ? (
        <div className={cn("flex flex-wrap gap-1.5 px-4 pb-2", onStop && anyAgentActive && "pr-12")}>
          {entries.map((e) => (
            <span
              key={e.participantId}
              className={cn(
                "inline-flex max-w-[200px] items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2 text-xs transition-opacity",
                e.done && "opacity-60"
              )}
            >
              <EntryAvatar entry={e} avatarUrl={avatarOf(e.participantId)} />
              <EntryOrb entry={e} />
              <span className="font-medium">{e.name}</span>
              <EntryLabel entry={e} className="text-muted-foreground" />
            </span>
          ))}
        </div>
      ) : (
        <ul className={cn("flex flex-col px-2 py-1", onStop && anyAgentActive && "pr-12")}>
          {entries.map((e) => (
            <li
              key={e.participantId}
              className={cn(
                "grid grid-cols-[20px_auto_20px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1 text-xs transition-opacity",
                e.done && "opacity-60"
              )}
            >
              <EntryAvatar entry={e} avatarUrl={avatarOf(e.participantId)} />
              <span className="whitespace-nowrap font-medium">{e.name}</span>
              <EntryOrb entry={e} />
              <EntryLabel entry={e} className="text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}

      {onStop && anyAgentActive && (
        <button
          type="button"
          onClick={stopping ? undefined : onStop}
          disabled={stopping}
          title={t("stopAgents")}
          aria-label={t("stopAgents")}
          className={cn(
            "absolute right-3 top-1.5 flex h-7 w-7 items-center justify-center rounded-full",
            "border border-border bg-card text-muted-foreground shadow-sm transition-colors",
            stopping
              ? "cursor-not-allowed opacity-60"
              : "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          )}
        >
          {stopping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Square className="h-3 w-3 fill-current" />
          )}
        </button>
      )}
    </section>
  );
}

function EntryAvatar({
  entry,
  avatarUrl,
  className,
}: {
  entry: ActivityEntry;
  avatarUrl?: string;
  className?: string;
}) {
  return (
    <Avatar className={cn("h-5 w-5", entry.type === "agent" && "rounded-md", className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={entry.name} />}
      <AvatarFallback className={cn("bg-muted", entry.type === "agent" && "rounded-md")}>
        {entry.type === "agent" ? (
          <Bot className="h-3 w-3 text-muted-foreground" />
        ) : (
          <User className="h-3 w-3 text-muted-foreground" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}

function EntryOrb({ entry }: { entry: ActivityEntry }) {
  if (entry.done) return <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />;
  if (entry.kind === "typing") {
    return <PhaseOrb state="composing" className="shrink-0" />;
  }
  const phase = entry.phase ?? "working";
  return (
    <PhaseOrb phase={phase} active={PHASE_IS_ACTIVE[phase] ?? true} className="shrink-0" />
  );
}

function EntryLabel({ entry, className }: { entry: ActivityEntry; className?: string }) {
  const { t } = useTranslation("chat");
  let text: string;
  if (entry.done) text = t("activityDock.rowDone");
  else if (entry.kind === "typing")
    text = entry.type === "agent" ? t("activityDock.rowProcessing") : t("activityDock.rowTyping");
  else if (entry.kind === "stream")
    text =
      entry.phaseDetail ??
      t(STREAM_PHASE_LABEL_KEYS[entry.phase as keyof typeof STREAM_PHASE_LABEL_KEYS] ?? STREAM_PHASE_FALLBACK_LABEL_KEY);
  else text = t(activityLabelKey((entry.phase ?? "working") as AgentActivity));
  return (
    <span className={cn("min-w-0 truncate", entry.done && "text-success", className)} title={text}>
      {text}
    </span>
  );
}
