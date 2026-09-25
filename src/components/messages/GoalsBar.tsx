import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { useRoomGoalsStore } from "../../stores/roomGoalsStore";
import { GoalsPanel } from "./GoalsPanel";

/**
 * Header chip: target icon + the number of open room goals — what the
 * people (and agents) in this room asked it to get done. Hidden when the
 * room has none. Clicking opens GoalsPanel below the chip. Same shape as
 * ArtifactsBar / ThreadsBar. Mirrors web's GoalsBar.
 */
export function GoalsBar({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const goals = useRoomGoalsStore((s) => s.goals[conversationId]);
  const fetchGoals = useRoomGoalsStore((s) => s.fetchGoals);

  useEffect(() => {
    fetchGoals(conversationId);
  }, [conversationId, fetchGoals]);

  const count = goals?.length ?? 0;
  if (count === 0) return null;

  const chipLabel = t("goals.chip", { count });

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-[11px] font-semibold text-primary transition-colors hover:bg-accent"
        aria-expanded={open}
        aria-label={chipLabel}
        title={chipLabel}
      >
        <Target className="h-3.5 w-3.5" />
        <span>{count}</span>
      </button>

      <GoalsPanel
        conversationId={conversationId}
        goals={goals ?? []}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
