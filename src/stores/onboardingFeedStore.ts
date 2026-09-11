import { useMemo } from "react";
import { create } from "zustand";

import type { LifecycleStage } from "../lib/api";
import { onboardingEventKey, type OnboardingProgressEvent } from "./onboardingToastStore";

/**
 * An onboarding review the user hasn't looked at yet.
 *
 * Only what the "Recent onboarding progress" group needs to render a line —
 * the review's real record is the timeline row the Onboarding section
 * fetches from the server. A "you haven't seen this" marker, not a second
 * copy.
 */
export interface UnseenOnboardingEvent {
  key: string;
  reviewId: string | null;
  agentId: string;
  agentName?: string;
  stage: LifecycleStage;
  confidence: number;
  delta: number;
  note: string | null;
  soulChanged: boolean;
  transition: null | "established" | "reopened";
  seenAt: number;
}

const STORAGE_KEY = "onboarding:unseen";
/** Beyond this the section's timeline says the same thing anyway. Oldest fall off. */
const CAP = 100;

function load(): UnseenOnboardingEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UnseenOnboardingEvent[]) : [];
  } catch {
    return [];
  }
}

function persist(unseen: UnseenOnboardingEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unseen));
  } catch {
    // Quota or a locked-down store — the feed is a convenience, not a
    // record; losing it across restarts is acceptable.
  }
}

/**
 * The persistent half of the onboarding-progress surface (twin of
 * memoryFeedStore).
 *
 * The live notification is `OnboardingProgressToast` (the progress island).
 * Reviews with a negligible delta deliberately skip the island, so they'd
 * otherwise be invisible. Every event (island-worthy or not) is recorded
 * here and surfaces as a "Recent onboarding progress" group at the top of
 * that agent's Onboarding section. Cleared per-agent once the section has
 * been read.
 */
interface OnboardingFeedState {
  /** Newest first. */
  unseen: UnseenOnboardingEvent[];
  record: (event: OnboardingProgressEvent) => void;
  /** Called when the agent's Onboarding section has been shown — drops its marks. */
  markAgentSeen: (agentId: string) => void;
  clearAll: () => void;
}

export const useOnboardingFeedStore = create<OnboardingFeedState>((set) => ({
  unseen: load(),
  record: (event) =>
    set((s) => {
      const key = onboardingEventKey(event);
      // A re-broadcast of a review that's already unseen moves to the front
      // rather than stacking a second mark for one row.
      const unseen = [
        {
          key,
          reviewId: event.reviewId,
          agentId: event.agentId,
          agentName: event.agentName,
          stage: event.stage,
          confidence: event.confidence,
          delta: event.delta,
          note: event.note,
          soulChanged: event.soulChanged,
          transition: event.transition,
          seenAt: Date.now(),
        },
        ...s.unseen.filter((u) => u.key !== key),
      ].slice(0, CAP);
      persist(unseen);
      return { unseen };
    }),
  markAgentSeen: (agentId) =>
    set((s) => {
      const unseen = s.unseen.filter((u) => u.agentId !== agentId);
      if (unseen.length === s.unseen.length) return s;
      persist(unseen);
      return { unseen };
    }),
  clearAll: () =>
    set(() => {
      persist([]);
      return { unseen: [] };
    }),
}));

/**
 * This agent's unseen onboarding events, newest first. Memoized off the
 * whole array so the filter doesn't mint a new ref on unrelated updates.
 */
export function useUnseenOnboarding(agentId: string): UnseenOnboardingEvent[] {
  const unseen = useOnboardingFeedStore((s) => s.unseen);
  return useMemo(() => unseen.filter((u) => u.agentId === agentId), [unseen, agentId]);
}
