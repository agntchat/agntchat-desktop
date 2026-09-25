import { create } from "zustand";
import { request } from "../lib/api";
import { ws } from "../services/websocket";

/** One open room goal (backend `RoomGoalJSON`). */
export interface RoomGoal {
  id: string;
  /** The handle agents see in their prompt as `[goal <shortId>]`. */
  shortId: string;
  /** The words of the message(s) that set it. */
  statement: string;
  setBy: string | null;
  /** Agents the goal names; empty = the whole room. */
  owners: string[];
  /** Later messages that changed it, oldest first. */
  updates: string[];
  progress: { note: string; by: string | null } | null;
  lastTouchedAt: string;
}

interface GoalsResponse {
  conversationId: string;
  goals: RoomGoal[];
}

interface RoomGoalsState {
  goals: Record<string, RoomGoal[]>;
  fetchGoals: (conversationId: string) => Promise<void>;
  /** A person marks a goal done or drops it. Throws on failure. */
  closeGoal: (
    conversationId: string,
    goalId: string,
    status: "done" | "dropped"
  ) => Promise<void>;
  initWsListeners: () => () => void;
}

/**
 * The room goal ledger behind the header GoalsBar chip. Loaded by REST when
 * a conversation opens and kept live by the conversation channel's
 * `room_goals` push, which carries the whole open list on every change.
 * Ported from web/src/stores/roomGoalsStore.ts with no behavior change.
 */
export const useRoomGoalsStore = create<RoomGoalsState>((set) => ({
  goals: {},

  fetchGoals: async (conversationId) => {
    try {
      const data = await request<GoalsResponse>(
        `/api/conversations/${conversationId}/goals`
      );
      set((s) => ({ goals: { ...s.goals, [conversationId]: data.goals } }));
    } catch {
      // No chip is the right failure: goals are context, not content.
    }
  },

  closeGoal: async (conversationId, goalId, status) => {
    const data = await request<GoalsResponse>(
      `/api/conversations/${conversationId}/goals/${goalId}/close`,
      { method: "POST", body: JSON.stringify({ status }) }
    );
    set((s) => ({ goals: { ...s.goals, [conversationId]: data.goals } }));
  },

  initWsListeners: () =>
    ws.on("conv:room_goals", (payload: Record<string, unknown>) => {
      const convId = payload._conversationId as string;
      const goals = payload.goals as RoomGoal[] | undefined;
      if (!convId || !Array.isArray(goals)) return;
      set((s) => ({ goals: { ...s.goals, [convId]: goals } }));
    }),
}));
