import { create } from "zustand";
import { listRoutines } from "../lib/api";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";
import type { Routine } from "../lib/api";
import { isFresh } from "../lib/cache";

/**
 * Every routine visible to the signed-in account, across all of its agents —
 * the unscoped `/api/routines` feed that backs the unified Actions list.
 *
 * A store rather than component state because the Tasks view is unmounted on
 * every sidebar switch: held locally, the list was discarded and re-fetched
 * (behind a spinner) each time you came back. Per-agent routine lists in
 * AgentConfig fetch their own agent-scoped slice and don't go through here.
 */
interface RoutineState {
  routines: Routine[];
  loadedAt: number;
  loading: boolean;

  /** @internal in-flight fetch, so concurrent callers share one request */
  _inflight: Promise<void> | null;

  fetchRoutines: () => Promise<void>;
  fetchRoutinesIfStale: () => Promise<void>;
  /** Apply `routine_updated` pushes: upsert, or drop when `deleted`. */
  initWsListeners: () => () => void;
  /** Fold a server-confirmed row back into the list — the Actions detail
   *  pane edits routines without going through a refetch. */
  upsertRoutine: (routine: Routine) => void;
}

export const useRoutineStore = create<RoutineState>((set, get) => ({
  routines: [],
  loadedAt: 0,
  loading: false,
  _inflight: null,

  fetchRoutines: async () => {
    set({ loading: get().routines.length === 0 });
    try {
      const { routines } = await listRoutines();
      set({ routines: routines ?? [], loadedAt: Date.now() });
    } catch (e) {
      console.warn("[routines] fetch failed", e);
    } finally {
      set({ loading: false });
    }
  },

  upsertRoutine: (routine) =>
    set((s) => ({
      routines: s.routines.some((r) => r.id === routine.id)
        ? s.routines.map((r) => (r.id === routine.id ? routine : r))
        : [routine, ...s.routines],
    })),

  initWsListeners: () =>
    ws.on("routine_updated", (payload) => {
      const routine = payload as unknown as Routine & { deleted?: boolean; change?: string };
      // Slack-style: a routine in a workspace the user isn't active in stays
      // out of this list, like tasks and to-dos do.
      const activeOrg = useAuthStore.getState().participant?.activeOrganizationId;
      if (routine.organizationId && activeOrg && routine.organizationId !== activeOrg) return;
      if (routine.deleted) {
        set((s) => ({ routines: s.routines.filter((r) => r.id !== routine.id) }));
      } else {
        get().upsertRoutine(routine);
      }
    }),

  fetchRoutinesIfStale: async () => {
    const inflight = get()._inflight;
    if (inflight) return inflight;
    if (isFresh(get().loadedAt)) return;
    const p = get()
      .fetchRoutines()
      .finally(() => set({ _inflight: null }));
    set({ _inflight: p });
    return p;
  },
}));
