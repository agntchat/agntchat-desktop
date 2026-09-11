import { create } from "zustand";

import type { LifecycleStage, OnboardingDimension } from "../lib/api";

/** Payload pushed on the user channel when an onboarding review lands
 *  (camelCase — `Onboarding.Notifier.progress/2`). Owner only. */
export interface OnboardingProgressEvent {
  agentId: string;
  agentName?: string;
  agentAvatarUrl?: string | null;
  stage: LifecycleStage;
  confidence: number;
  /** Change since the previous review — may be 0 (bookkeeping rows). */
  delta: number;
  dimensions: Partial<Record<OnboardingDimension, number>>;
  /** First-person one-liner from the review; null for bookkeeping rows. */
  note: string | null;
  soulChanged: boolean;
  reviewId: string | null;
  improvementId: string | null;
  transition: null | "established" | "reopened";
}

/** Reviews carry an id; soul-change bookkeeping rows may not, so those are
 *  keyed on the agent + arrival time. Used to dedupe the queue and the feed. */
export function onboardingEventKey(event: OnboardingProgressEvent): string {
  return event.reviewId ?? `${event.agentId}:${Date.now()}`;
}

/**
 * Queue of onboarding reviews awaiting their moment as the progress island.
 *
 * Mirrors memoryToastStore: only island-worthy events are pushed here (a
 * review that barely moved the needle is filed straight into
 * onboardingFeedStore — see OnboardingProgressToast), and the head of the
 * queue is what's on screen.
 */
export interface QueuedOnboardingEvent extends OnboardingProgressEvent {
  key: string;
}

interface OnboardingToastState {
  queue: QueuedOnboardingEvent[];
  push: (event: OnboardingProgressEvent) => void;
  /** Drop the currently shown (head) event; the next one, if any, shows. */
  dismiss: () => void;
  /** Drop everything — used by "Review", which lands on the full timeline anyway. */
  clear: () => void;
}

export const useOnboardingToastStore = create<OnboardingToastState>((set) => ({
  queue: [],
  push: (event) =>
    set((s) => {
      const key = onboardingEventKey(event);
      // A re-broadcast of the same review replaces the queued entry instead
      // of stacking duplicates.
      return { queue: [...s.queue.filter((e) => e.key !== key), { ...event, key }] };
    }),
  dismiss: () => set((s) => ({ queue: s.queue.slice(1) })),
  clear: () => set({ queue: [] }),
}));
