import { useTranslation } from "react-i18next";

import type { Agent } from "../lib/api";
import { cn } from "../lib/utils";
import { PhaseOrb } from "./PhaseOrb";

/** Percent settled, 0..100, from the rollup's 0..1 confidence. */
export function onboardingPct(agent: Pick<Agent, "onboarding">): number {
  return Math.round((agent.onboarding?.confidence ?? 0) * 100);
}

export function isOnboarding(agent: Pick<Agent, "lifecycleStage">): boolean {
  return agent.lifecycleStage === "onboarding";
}

/**
 * "Onboarding · 51%" next to an agent's name while it is still a new hire.
 * The dot is the thinking orb in its `connecting` state — the repo
 * convention for a new status indicator is to reuse an orb state, never a
 * plain dot. Renders nothing once the agent is established. Kept in parity
 * with the web client's chip.
 */
export function OnboardingChip({
  agent,
  className,
}: {
  agent: Pick<Agent, "lifecycleStage" | "onboarding">;
  className?: string;
}) {
  const { t } = useTranslation("agents");
  if (!isOnboarding(agent)) return null;
  const pct = onboardingPct(agent);
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-4xl border border-primary/20 bg-primary/10 pl-1 pr-1.5 text-[10px] font-medium text-primary whitespace-nowrap",
        className
      )}
      title={t("onboarding.settled", { pct })}
    >
      <PhaseOrb state="connecting" className="shrink-0 scale-[0.7]" />
      {t("onboarding.badgeWithPct", { pct })}
    </span>
  );
}
