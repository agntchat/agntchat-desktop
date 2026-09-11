import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw } from "lucide-react";

import type { AgentImprovement } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Before/after of one soul revision, side by side. "Diff-ish": a line that
 * has no exact twin on the other side is tinted (removed on the left, added
 * on the right), which is enough to see what a review rewrote without a
 * real diff engine. Revert goes through the improvements API — the same
 * path the meta-loop's revisions use — and the caller refetches.
 */
export function SoulChangeDialog({
  improvement,
  loading,
  reverting,
  onRevert,
  onClose,
}: {
  improvement: AgentImprovement | null;
  loading: boolean;
  reverting: boolean;
  onRevert: (improvement: AgentImprovement) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("agents");
  const before = improvement?.changeData?.before ?? "";
  const after = improvement?.changeData?.after ?? "";
  const { removed, added } = useMemo(
    () => lineChanges(before, after),
    [before, after],
  );
  const reverted = improvement?.status === "reverted";

  return (
    <Dialog
      open={loading || improvement !== null}
      onOpenChange={(o) => !o && onClose()}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("onboarding.soulRevised")}
            {reverted && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {t("onboarding.reverted")}
              </Badge>
            )}
          </DialogTitle>
          {improvement?.description && (
            <DialogDescription>{improvement.description}</DialogDescription>
          )}
        </DialogHeader>

        {loading || !improvement ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-h-[60vh] min-h-0">
            <SoulPane
              label={t("onboarding.before")}
              text={before}
              tint={removed}
              tone="removed"
            />
            <SoulPane
              label={t("onboarding.after")}
              text={after}
              tint={added}
              tone="added"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common:close")}
          </Button>
          {improvement && !reverted && (
            <Button
              variant="destructive"
              size="sm"
              disabled={reverting}
              onClick={() => onRevert(improvement)}
            >
              {reverting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t("onboarding.revert")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SoulPane({
  label,
  text,
  tint,
  tone,
}: {
  label: string;
  text: string;
  tint: Set<number>;
  tone: "removed" | "added";
}) {
  const lines = text.split("\n");
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words -mx-1 px-1 rounded-sm",
              tint.has(i) &&
                (tone === "removed" ? "bg-destructive/15" : "bg-success/15"),
            )}
          >
            {line || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Line indexes present on only one side (after trimming), by side. */
function lineChanges(before: string, after: string) {
  const norm = (s: string) => s.trim();
  const beforeLines = before.split("\n").map(norm);
  const afterLines = after.split("\n").map(norm);
  const inBefore = new Set(beforeLines.filter(Boolean));
  const inAfter = new Set(afterLines.filter(Boolean));
  const removed = new Set<number>();
  const added = new Set<number>();
  beforeLines.forEach((l, i) => {
    if (l && !inAfter.has(l)) removed.add(i);
  });
  afterLines.forEach((l, i) => {
    if (l && !inBefore.has(l)) added.add(i);
  });
  return { removed, added };
}
