import { MessagesSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import {
  isResolvedHuddle,
  selectChildHuddles,
} from "../../lib/huddle-selectors";
import { useChatStore } from "../../stores/chatStore";
import { HuddlesPanel } from "./HuddlesPanel";

/**
 * Header chip: huddle icon + open count (+ unread badge). Lives in the
 * conversation header next to the files chip and the Info toggle — never
 * floating over message content. Stays visible whenever the parent has any
 * huddle (open OR resolved) so users can drop back into past huddles.
 * Click opens the dropdown panel (anchored below the chip) with the full
 * huddle list.
 *
 * Styling switches based on what's left:
 *   - Open huddles exist → primary-tinted count with open count + unread
 *   - Only resolved huddles → muted count
 *   - Nothing at all → hidden
 *
 * Mirrors mobile/components/HuddlesBar.tsx (which renders in the native
 * header's headerRight).
 */
export function HuddlesBar({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const agentConversations = useChatStore((s) => s.agentConversations);
  const unreadCounts = useChatStore((s) => s.unreadCounts);

  const { openHuddles, resolvedHuddles } = useMemo(() => {
    const all = selectChildHuddles(agentConversations, conversationId);
    return {
      openHuddles: all.filter((t) => !isResolvedHuddle(t)),
      resolvedHuddles: all.filter((t) => isResolvedHuddle(t)),
    };
  }, [agentConversations, conversationId]);

  const unreadTotal = useMemo(
    () => openHuddles.reduce((sum, t) => sum + (unreadCounts[t.id] ?? 0), 0),
    [openHuddles, unreadCounts]
  );

  const totalCount = openHuddles.length + resolvedHuddles.length;
  if (totalCount === 0) return null;

  const allResolved = openHuddles.length === 0;
  const chipLabel = allResolved
    ? t("huddles.resolvedCount", { count: resolvedHuddles.length })
    : t("huddles.count", { count: openHuddles.length });

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-[11px] font-semibold transition-colors hover:bg-accent",
          allResolved ? "text-muted-foreground" : "text-primary"
        )}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        aria-expanded={open}
        aria-label={chipLabel}
        title={chipLabel}
      >
        <MessagesSquare className="h-3.5 w-3.5" />
        <span>{allResolved ? resolvedHuddles.length : openHuddles.length}</span>
        {unreadTotal > 0 ? (
          <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        ) : null}
      </button>

      <HuddlesPanel
        parentConversationId={conversationId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
