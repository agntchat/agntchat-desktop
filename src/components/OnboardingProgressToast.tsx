import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ws } from "../services/websocket";
import { useNavStore } from "../stores/navStore";
import { useAgentStore } from "../stores/agentStore";
import {
  useOnboardingToastStore,
  type OnboardingProgressEvent,
} from "../stores/onboardingToastStore";
import { useOnboardingFeedStore } from "../stores/onboardingFeedStore";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * "Progress island" — the transient surface for agent onboarding reviews,
 * the twin of MemorySavedToast. The agent's avatar appears top-center,
 * blooms into a pill saying who is finding their footing and how settled
 * they are, holds, then collapses back and fades. Clicking the open pill
 * deep-links to that agent's Onboarding section. Mounted once in AppShell.
 *
 * Deliberately picky, like the memory island: every event is recorded in
 * onboardingFeedStore ("Recent onboarding progress" in the section), but
 * only a review that actually moved something blooms — a checkpoint that
 * nudged confidence by a point would otherwise strobe the top of the app
 * during a busy afternoon.
 */
const HOLD_MS = 2500;
/** A stage transition is the one line the owner should not miss. */
const TRANSITION_HOLD_MS = 4000;
const COLLAPSE_MS = 240;
/** Below this the review is filed, not announced. */
const MIN_BLOOM_DELTA = 0.02;

/** Whether an event earns an island (vs. only the feed). Exported so the
 *  section's feed group can style the loud ones the same way. */
export function onboardingEventBlooms(event: OnboardingProgressEvent): boolean {
  return (
    event.transition !== null ||
    event.soulChanged ||
    Math.abs(event.delta) >= MIN_BLOOM_DELTA
  );
}

export function OnboardingProgressToast() {
  const { t } = useTranslation("agents");
  const event = useOnboardingToastStore((s) => s.queue[0] ?? null);
  const queued = useOnboardingToastStore((s) => s.queue.length);
  const push = useOnboardingToastStore((s) => s.push);
  const openOnboardingDeepLink = useNavStore((s) => s.openOnboardingDeepLink);
  const setView = useNavStore((s) => s.setView);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const [open, setOpen] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const unsub = ws.on("onboarding_progress", (payload) => {
      const progress = payload as unknown as OnboardingProgressEvent;
      // Everything lands in the feed — that's the surface that survives.
      useOnboardingFeedStore.getState().record(progress);

      // A review that barely moved the needle never blooms.
      if (!onboardingEventBlooms(progress)) return;
      // Nor does one for the agent whose Onboarding section is already
      // open — the timeline row is about to appear under the user's cursor.
      const nav = useNavStore.getState();
      if (
        nav.view === "agents" &&
        nav.agentConfigSection === "onboarding" &&
        useAgentStore.getState().selectedAgentId === progress.agentId
      ) {
        return;
      }

      push(progress);
    });
    return unsub;
  }, [push]);

  // Bloom → hold → collapse → advance, restarted for each queued event.
  const eventKey = event?.key ?? null;
  const holdMs = event?.transition ? TRANSITION_HOLD_MS : HOLD_MS;
  useEffect(() => {
    if (!eventKey) return;
    setOpen(false);
    const clearAll = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };

    timers.current.push(window.setTimeout(() => setOpen(true), 40));
    timers.current.push(window.setTimeout(() => setOpen(false), 40 + holdMs));
    timers.current.push(
      window.setTimeout(
        () => useOnboardingToastStore.getState().dismiss(),
        40 + holdMs + COLLAPSE_MS
      )
    );
    return clearAll;
  }, [eventKey, holdMs]);

  if (!event) return null;

  const pct = Math.round(event.confidence * 100);
  const title = onboardingToastTitle(t, event, pct);
  const subline = [event.note, event.soulChanged ? t("onboarding.toast.soulRevised") : null]
    .filter(Boolean)
    .join(" · ");

  const review = () => {
    useOnboardingToastStore.getState().clear();
    void selectAgent(event.agentId);
    openOnboardingDeepLink(event.agentId);
    setView("agents");
  };

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2">
      <button
        type="button"
        onClick={review}
        title={`${t("onboarding.toast.review")} — ${title}`}
        className={[
          "pointer-events-auto relative flex h-11 items-center overflow-hidden rounded-full",
          "bg-foreground text-background shadow-lg transition-[max-width] duration-300 ease-out",
          open ? "max-w-md" : "max-w-11",
        ].join(" ")}
      >
        <ToastAvatar name={event.agentName} avatarUrl={event.agentAvatarUrl} />
        <span
          className={[
            "min-w-0 pr-5 text-left transition-opacity duration-200",
            open ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          <span className="block truncate text-xs font-medium">
            {title}
            {queued > 1 ? `  ·  +${queued - 1}` : ""}
          </span>
          {subline && (
            <span className="block truncate text-[11px] opacity-70">{subline}</span>
          )}
        </span>
      </button>
    </div>
  );
}

/** Which headline the event gets: a plain progress line carries the
 *  percentage; a transition is its own sentence. */
function onboardingToastTitle(
  t: (key: string, opts?: Record<string, unknown>) => string,
  event: Pick<OnboardingProgressEvent, "agentName" | "transition">,
  pct: number
): string {
  if (!event.agentName) return t("onboarding.toast.titleUnknown");
  if (event.transition === "established") {
    return t("onboarding.toast.titleCleared", { name: event.agentName });
  }
  if (event.transition === "reopened") {
    return t("onboarding.toast.titleReopened", { name: event.agentName });
  }
  return `${t("onboarding.toast.title", { name: event.agentName })} · ${t(
    "onboarding.settled",
    { pct }
  )}`;
}

function ToastAvatar({ name, avatarUrl }: { name?: string; avatarUrl?: string | null }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center">
      <Avatar className="h-7 w-7 rounded-lg">
        {avatarUrl && <AvatarImage src={avatarUrl} className="rounded-lg" displaySize={28} />}
        <AvatarFallback className="rounded-lg bg-primary/20 text-primary text-[11px] font-semibold">
          {(name ?? "?").charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    </span>
  );
}

/** Presentational island for the component preview gallery — always open. */
export function OnboardingProgressToastCard({
  title,
  content,
  name,
}: {
  title: string;
  content: string;
  name: string;
}) {
  return (
    <div className="flex h-11 max-w-md items-center overflow-hidden rounded-full bg-foreground text-background shadow-lg">
      <ToastAvatar name={name} />
      <span className="min-w-0 pr-5 text-left">
        <span className="block truncate text-xs font-medium">{title}</span>
        <span className="block truncate text-[11px] opacity-70">{content}</span>
      </span>
    </div>
  );
}
