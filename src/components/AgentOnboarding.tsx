import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  GraduationCap,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sprout,
  Sparkles,
} from "lucide-react";

import {
  clearOnboarding,
  getAgentOnboarding,
  listImprovements,
  reopenOnboarding,
  requestOnboardingReview,
  revertImprovement,
  type AgentImprovement,
  type OnboardingClearedBy,
  type OnboardingDimension,
  type OnboardingReview,
  type OnboardingRollup,
  type OnboardingTrigger,
} from "../lib/api";
import { cn, formatExactDateTime, formatRelativeShort } from "../lib/utils";
import { useAgentStore } from "../stores/agentStore";
import { useOnboardingFeedStore, useUnseenOnboarding } from "../stores/onboardingFeedStore";
import { isOnboarding, onboardingPct } from "./OnboardingChip";
import { SoulChangeDialog } from "./SoulChangeDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Rail labels resolved with t() at render time; literal keys so the i18n
// audit can see them.
const DIMENSION_LABEL_KEYS: Record<OnboardingDimension, string> = {
  role_clarity: "onboarding.dimensions.roleClarity",
  owner_fit: "onboarding.dimensions.ownerFit",
  craft: "onboarding.dimensions.craft",
  judgment: "onboarding.dimensions.judgment",
  voice: "onboarding.dimensions.voice",
};

const DIMENSIONS = Object.keys(DIMENSION_LABEL_KEYS) as OnboardingDimension[];

const TRIGGER_LABEL_KEYS: Record<OnboardingTrigger, string> = {
  turn_checkpoint: "onboarding.trigger.turn_checkpoint",
  task_outcome: "onboarding.trigger.task_outcome",
  owner_signal: "onboarding.trigger.owner_signal",
  self_edit: "onboarding.trigger.self_edit",
  owner_edit: "onboarding.trigger.owner_edit",
  meta_loop: "onboarding.trigger.meta_loop",
  backstop: "onboarding.trigger.backstop",
  manual: "onboarding.trigger.manual",
};

const CLEARED_BY_KEYS: Record<OnboardingClearedBy, string> = {
  auto: "onboarding.clearedBy.auto",
  owner: "onboarding.clearedBy.owner",
  backfill: "onboarding.clearedBy.backfill",
  birth: "onboarding.clearedBy.birth",
};

const pctOf = (confidence: number | undefined) => Math.round((confidence ?? 0) * 100);

/**
 * The Onboarding section of the agent detail pane: where a new hire stands
 * (stage, confidence, the five dimensions with their latest evidence), the
 * review timeline, and the owner's overrides. The rollup comes off the
 * agent record (kept live by `agent_updated`); the timeline is fetched here
 * and refetched whenever the rollup says a review landed.
 */
export function AgentOnboarding({
  agentId,
  agentName,
  onDeepLinkConsumed,
}: {
  agentId: string;
  agentName: string;
  /** Present when the progress island's Review deep-link opened this
   *  section — called once so the caller can clear the pending link. */
  onDeepLinkConsumed?: () => void;
}) {
  const { t } = useTranslation("agents");
  const agent = useAgentStore((s) => s.agents[agentId]?.agent);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const [reviews, setReviews] = useState<OnboardingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"review" | "clear" | "reopen" | null>(null);
  const [reviewQueued, setReviewQueued] = useState(false);
  const [improvements, setImprovements] = useState<Record<string, AgentImprovement>>({});
  const [viewing, setViewing] = useState<string | null>(null);

  // AgentConfig only passes the callback while a deep-link is pending, so
  // its arrival (not just mount) is what consumes the link — a second
  // island click while this section is already open still clears it.
  useEffect(() => {
    onDeepLinkConsumed?.();
  }, [onDeepLinkConsumed]);

  // Per-agent state — the pane is one reused instance across selections.
  useEffect(() => {
    setReviews([]);
    setLoading(true);
    setReviewQueued(false);
    setImprovements({});
    setViewing(null);
  }, [agentId]);

  // Reading the section IS the acknowledgement — clear this agent's unseen
  // marks on the way out, so the group survives being looked at.
  const unseen = useUnseenOnboarding(agentId);
  useEffect(
    () => () => useOnboardingFeedStore.getState().markAgentSeen(agentId),
    [agentId]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const summary = await getAgentOnboarding(agentId);
      setReviews(summary.reviews);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("onboarding.failed"));
    } finally {
      setLoading(false);
    }
  }, [agentId, t]);

  // The rollup's review count / stage move on every review (agent_updated),
  // so keying the refetch on them keeps the timeline live without a second
  // WS subscription here.
  const rollup: OnboardingRollup | undefined = agent?.onboarding;
  const stage = agent?.lifecycleStage;
  useEffect(() => {
    void load();
  }, [load, rollup?.reviewCount, rollup?.lastReviewAt, rollup?.reopenedAt, stage]);

  // Owner actions. Errors land in the banner; the agent record refreshes
  // through selectAgent so the stage pill and rail badge move at once.
  const run = async (
    kind: "review" | "clear" | "reopen",
    action: () => Promise<unknown>
  ) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      if (kind === "review") setReviewQueued(true);
      else await selectAgent(agentId);
      await load();
    } catch {
      setError(t("onboarding.failed"));
    } finally {
      setBusy(null);
    }
  };

  const onReviewNow = () => run("review", () => requestOnboardingReview(agentId));
  const onMarkEstablished = () => {
    if (!window.confirm(t("onboarding.confirmClear", { name: agentName }))) return;
    void run("clear", () => clearOnboarding(agentId));
  };
  const onSendBack = () => {
    if (!window.confirm(t("onboarding.confirmReopen", { name: agentName }))) return;
    void run("reopen", () => reopenOnboarding(agentId));
  };

  // Soul-change viewer: improvements are fetched lazily on the first "View
  // change" and cached by id; a revert updates the cached row and refetches.
  const [viewLoading, setViewLoading] = useState(false);
  const [reverting, setReverting] = useState(false);

  const viewChange = async (improvementId: string) => {
    setViewing(improvementId);
    if (improvements[improvementId]) return;
    setViewLoading(true);
    try {
      const { improvements: rows } = await listImprovements(agentId, { limit: 200 });
      setImprovements(Object.fromEntries(rows.map((r) => [r.id, r])));
    } catch {
      setError(t("onboarding.failed"));
      setViewing(null);
    } finally {
      setViewLoading(false);
    }
  };

  const onRevert = async (imp: AgentImprovement) => {
    setReverting(true);
    try {
      const { improvement } = await revertImprovement(agentId, imp.id);
      setImprovements((prev) => ({ ...prev, [improvement.id]: improvement }));
      await selectAgent(agentId);
      await load();
    } catch {
      setError(t("onboarding.failed"));
    } finally {
      setReverting(false);
    }
  };

  if (!agent) return null;
  const onboarding = isOnboarding(agent);
  const pct = onboardingPct(agent);

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sprout className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{t("onboarding.sectionTitle")}</h3>
            <StagePill onboarding={onboarding} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t("onboarding.sectionSubtitle", { name: agentName })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onboarding && (
            <>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={onReviewNow}>
                {busy === "review" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t("onboarding.reviewNow")}
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={onMarkEstablished}>
                {busy === "clear" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
                )}
                {t("onboarding.markEstablished")}
              </Button>
            </>
          )}
          {!onboarding && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={onSendBack}>
              {busy === "reopen" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t("onboarding.sendBack")}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
      {reviewQueued && (
        <div className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg p-3">
          {t("onboarding.reviewQueued")}
        </div>
      )}

      {/* Overview: ring + the rollup's one-liners. */}
      <div className="flex items-start gap-5 rounded-lg border border-border p-4">
        <ProgressRing pct={pct} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">
              {t("onboarding.settled", { pct })}
            </span>
            {rollup?.ready !== undefined && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] px-1.5 py-0",
                  rollup.ready
                    ? "bg-success/10 text-success border-success/20"
                    : "bg-muted text-muted-foreground border-transparent"
                )}
              >
                {rollup.ready ? t("onboarding.ready") : t("onboarding.notReady")}
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">
              {t("onboarding.reviews", { count: rollup?.reviewCount ?? 0 })}
            </span>
          </div>
          {rollup?.lastNote && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("onboarding.lastNote")}
              </div>
              <p className="text-xs text-foreground mt-0.5">{rollup.lastNote}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {rollup?.startedAt && (
              <span title={formatExactDateTime(rollup.startedAt)}>
                {t("onboarding.startedAt", { date: formatExactDateTime(rollup.startedAt) })}
              </span>
            )}
            {rollup?.clearedAt && (
              <span title={formatExactDateTime(rollup.clearedAt)}>
                {t("onboarding.clearedAt", { date: formatExactDateTime(rollup.clearedAt) })}
              </span>
            )}
            {rollup?.clearedBy && <span>{t(CLEARED_BY_KEYS[rollup.clearedBy])}</span>}
          </div>
        </div>
      </div>

      {/* The five dimensions with the latest evidence line each. */}
      <div className="space-y-3">
        {DIMENSIONS.map((dim) => {
          const score = rollup?.dimensions?.[dim];
          const evidence = rollup?.dimensionEvidence?.[dim];
          return (
            <div key={dim}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{t(DIMENSION_LABEL_KEYS[dim])}</span>
                <span className="tabular-nums text-muted-foreground">
                  {score === undefined ? "–" : `${pctOf(score)}%`}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${pctOf(score)}%` }}
                />
              </div>
              {evidence && (
                <p className="mt-1 text-[11px] text-muted-foreground">{evidence}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Reviews the user hasn't looked at yet — the quiet half of the
          progress island (it only blooms for reviews that moved something). */}
      {unseen.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" />
            {t("onboarding.feed.recent")} ({unseen.length})
          </div>
          <div className="space-y-1.5">
            {unseen.map((u) => (
              <div
                key={u.key}
                className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {u.transition === "established"
                      ? t("onboarding.toast.titleCleared", { name: agentName })
                      : u.transition === "reopened"
                        ? t("onboarding.toast.titleReopened", { name: agentName })
                        : t("onboarding.settled", { pct: pctOf(u.confidence) })}
                  </span>
                  {u.soulChanged && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t("onboarding.soulRevised")}
                    </Badge>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatRelativeShort(new Date(u.seenAt).toISOString())}
                  </span>
                </div>
                {u.note && <p className="mt-0.5 text-muted-foreground">{u.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review timeline. */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("onboarding.timeline")}
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <p className="text-xs text-muted-foreground">
              {t("onboarding.noReviews", { name: agentName })}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {reviews.map((r) => (
              <ReviewRow
                key={r.id}
                review={r}
                reverted={
                  r.improvementId ? improvements[r.improvementId]?.status === "reverted" : false
                }
                onViewChange={r.improvementId ? () => void viewChange(r.improvementId!) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <SoulChangeDialog
        improvement={viewing ? (improvements[viewing] ?? null) : null}
        loading={viewLoading}
        reverting={reverting}
        onRevert={(imp) => void onRevert(imp)}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

function StagePill({ onboarding }: { onboarding: boolean }) {
  const { t } = useTranslation("agents");
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[10px] px-1.5 py-0",
        onboarding
          ? "bg-primary/10 text-primary border-primary/20"
          : "bg-success/10 text-success border-success/20"
      )}
    >
      {onboarding ? t("onboarding.stageOnboarding") : t("onboarding.stageEstablished")}
    </Badge>
  );
}

/** Confidence as a ring — the same number the rail badge and list chip show. */
function ProgressRing({ pct }: { pct: number }) {
  const { t } = useTranslation("agents");
  const size = 72;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${t("onboarding.confidence")}: ${pct}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

function ReviewRow({
  review,
  reverted,
  onViewChange,
}: {
  review: OnboardingReview;
  reverted: boolean;
  onViewChange?: () => void;
}) {
  const { t } = useTranslation("agents");
  const before = pctOf(review.confidenceBefore);
  const after = pctOf(review.confidenceAfter);
  return (
    <div className="rounded-lg border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t(TRIGGER_LABEL_KEYS[review.trigger])}</span>
        {review.graduated && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 bg-success/10 text-success border-success/20"
          >
            <GraduationCap className="h-3 w-3" />
            {t("onboarding.graduated")}
          </Badge>
        )}
        {review.soulChanged && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {reverted ? t("onboarding.reverted") : t("onboarding.soulRevised")}
          </Badge>
        )}
        <span
          className="ml-auto tabular-nums text-muted-foreground"
          title={formatExactDateTime(review.insertedAt)}
        >
          {before !== after ? `${before}% → ${after}%` : `${after}%`}
          {" · "}
          {formatRelativeShort(review.insertedAt)}
        </span>
      </div>
      {review.note && <p className="mt-1 text-muted-foreground">{review.note}</p>}
      {onViewChange && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={onViewChange}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {t("onboarding.viewChange")}
          </button>
        </div>
      )}
    </div>
  );
}
