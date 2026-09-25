import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useRoomGoalsStore, type RoomGoal } from "../../stores/roomGoalsStore";

interface Props {
  conversationId: string;
  goals: RoomGoal[];
  open: boolean;
  onClose: () => void;
}

/**
 * Dropdown behind the header GoalsBar chip: every open room goal in the
 * words that set it, who set it, which agents it names, later changes, the
 * latest progress an agent recorded, and Mark done / Drop for the person
 * reading. Same anchor + dismiss behavior as ArtifactsPanel. Mirrors
 * web's GoalsPanel.
 */
export function GoalsPanel({ conversationId, goals, open, onClose }: Props) {
  const { t } = useTranslation("chat");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeGoal = useRoomGoalsStore((s) => s.closeGoal);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Click-outside + Escape to close — same pattern as ArtifactsPanel.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const id = window.setTimeout(() => {
      window.addEventListener("mousedown", onClick);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const close = async (goalId: string, status: "done" | "dropped") => {
    setBusy(goalId);
    setFailed(null);
    try {
      await closeGoal(conversationId, goalId, status);
    } catch {
      setFailed(goalId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-30 mt-2 w-[360px] max-h-[480px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold">{t("goals.panelTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("goals.hint")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("goals.closePanel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {goals.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">{t("goals.empty")}</p>
        )}
        {goals.map((goal) => (
          <div key={goal.id} className="border-b border-border px-4 py-3 last:border-b-0">
            <p className="line-clamp-4 whitespace-pre-wrap text-sm text-foreground">
              {goal.statement}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {goal.setBy ? t("goals.setBy", { name: goal.setBy }) : null}
              {goal.owners.length > 0 && (
                <>
                  {goal.setBy ? " · " : null}
                  {t("goals.forOwners", { names: goal.owners.join(", ") })}
                </>
              )}
            </p>

            {goal.updates.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("goals.sinceThen")}
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {goal.updates.map((u, i) => (
                    <li key={i} className="line-clamp-2 text-xs text-foreground">
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {goal.progress && (
              <div className="mt-2 rounded-md bg-muted px-2 py-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  {goal.progress.by
                    ? t("goals.latest", { name: goal.progress.by })
                    : t("goals.latestAnon")}
                </p>
                <p className="text-xs text-foreground">{goal.progress.note}</p>
              </div>
            )}

            {failed === goal.id && (
              <p className="mt-2 text-xs text-destructive">{t("goals.closeFailed")}</p>
            )}

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy === goal.id}
                onClick={() => close(goal.id, "done")}
                className="h-7 rounded-md border border-border-strong px-2 text-[11px] font-semibold text-primary hover:bg-accent disabled:opacity-50"
              >
                {t("goals.markDone")}
              </button>
              <button
                type="button"
                disabled={busy === goal.id}
                onClick={() => close(goal.id, "dropped")}
                className="h-7 rounded-md px-2 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {t("goals.drop")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
