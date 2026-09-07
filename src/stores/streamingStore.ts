import { create } from "zustand";
import { ws } from "../services/websocket";
import type { ActiveStream, StreamPhase } from "../lib/api";
import {
  STALE_STREAM_MS,
  STREAM_COMPLETE_LINGER_MS,
  STREAM_SWEEP_INTERVAL_MS,
} from "../lib/status-contract.generated";
import { useAuthStore } from "./authStore";

/**
 * `stream_text` feature flag — show the live token-by-token TEXT inside the
 * streaming bubble. When OFF, keep tracking the stream (so the phase indicator
 * still shows) but never populate `content`, so no streamed text renders.
 * Mirrors mobile/stores/streamingStore.ts.
 */
function streamTextEnabled(): boolean {
  return useAuthStore.getState().participant?.features?.stream_text === true;
}

/**
 * Ported from web/src/stores/streamingStore.ts.
 *
 * Tracks EVERY live stream per conversation, keyed by stream id, so several
 * agents working in the same group each keep their own entry — the activity
 * dock renders one row per participant from this map. Driven by the
 * `conv:message_streaming` WS event with a `status` of `started` |
 * `streaming` | `complete` | `cancelled`.
 *
 * Per-sender rules (a sender has at most one meaningful stream per
 * conversation):
 *  - a new active stream from a sender supersedes that sender's earlier
 *    streams here (steps/thoughts reset, as a stream replacement always did)
 *  - a passive `waiting`/`queued` signal never displaces the sender's active
 *    stream, and is dropped once the real stream begins
 *
 * A stream leaves the map:
 *  - on `cancelled` (that stream id; an unknown id falls back to the
 *    sender's passive streams only)
 *  - after `complete` + linger (the row reads "Done" meanwhile)
 *  - on `new_message` arrival with matching stream_id (clearStreamByStreamId)
 *    or matching senderId (clearStreamBySender) — wired in chatStore.
 *  - on stale (no update in STALE_STREAM_MS) — safety net if the backend
 *    cancellation event was missed.
 */

const MAX_STREAM_STEPS = 8;
const MAX_STREAM_THOUGHTS = 6;
/** Don't preserve trivial fragments (single tokens, partial words). */
const MIN_THOUGHT_CHARS = 12;
const FINAL_DELIVERY_PHASE_DETAILS = new Set([
  "send message",
  "sending message",
  "complete task",
  "completing task",
  "fail task",
  "failing task",
]);
const PASSIVE_PHASES = new Set<StreamPhase>(["waiting", "queued"]);

/**
 * Signal-originated "thinking" bubbles are purely speculative — the agent
 * hasn't started real work yet. Suppress them entirely and let the real
 * bridge/hosted stream provide the indicator when processing actually begins.
 * Signal "queued" and "waiting" phases still pass through (useful feedback
 * for offline/waiting agents).
 */

interface StreamEventInput {
  streamId: string;
  senderId: string;
  senderName?: string;
  status: string;
  phase?: StreamPhase;
  phaseDetail?: string;
  content?: string;
}

/** conversationId → streamId → stream */
export type ConversationStreams = Record<string, ActiveStream>;

interface StreamingState {
  streams: Record<string, ConversationStreams>;
  clearStream: (conversationId: string) => void;
  clearStreamBySender: (conversationId: string, senderId: string) => void;
  clearStreamByStreamId: (streamId: string) => void;
  /** Apply a streaming event (from WS or optimistic local send). */
  handleStreamEvent: (conversationId: string, input: StreamEventInput) => void;
  initWsListeners: () => () => void;
}

export function isPassivePhase(phase: StreamPhase): boolean {
  return PASSIVE_PHASES.has(phase);
}

function isFinalDeliveryToolPhase(phase: StreamPhase, detail?: string): boolean {
  if (phase !== "tool_call" || !detail) return false;
  const normalized = detail
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[.…]+$/g, "");
  return FINAL_DELIVERY_PHASE_DETAILS.has(normalized);
}

/** Immutable removal helper: drops `streamIds` from one conversation's map,
 *  deleting the conversation key when nothing is left. */
function without(
  streams: Record<string, ConversationStreams>,
  convId: string,
  streamIds: string[]
): Record<string, ConversationStreams> {
  const conv = streams[convId];
  if (!conv || streamIds.length === 0) return streams;
  const nextConv = { ...conv };
  let changed = false;
  for (const id of streamIds) {
    if (id in nextConv) {
      delete nextConv[id];
      changed = true;
    }
  }
  if (!changed) return streams;
  const next = { ...streams };
  if (Object.keys(nextConv).length === 0) delete next[convId];
  else next[convId] = nextConv;
  return next;
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  streams: {},

  clearStream: (conversationId) => {
    set((s) => {
      if (!s.streams[conversationId]) return s;
      const next = { ...s.streams };
      delete next[conversationId];
      return { streams: next };
    });
  },

  clearStreamBySender: (conversationId, senderId) => {
    set((s) => {
      const conv = s.streams[conversationId];
      if (!conv) return s;
      const ids = Object.values(conv)
        .filter((st) => st.senderId === senderId)
        .map((st) => st.streamId);
      return { streams: without(s.streams, conversationId, ids) };
    });
  },

  clearStreamByStreamId: (streamId) => {
    set((s) => {
      for (const [convId, conv] of Object.entries(s.streams)) {
        if (conv[streamId]) return { streams: without(s.streams, convId, [streamId]) };
      }
      return s;
    });
  },

  handleStreamEvent: (convId, input) => {
    const streamId = input.streamId;
    const status = input.status;
    const senderId = input.senderId;
    const content = input.content ?? "";
    const phase = input.phase ?? "thinking";
    const phaseDetail = input.phaseDetail;

    if (status === "cancelled") {
      set((s) => {
        const conv = s.streams[convId];
        if (!conv) return s;
        // The exact stream when we know it; otherwise only the sender's
        // PASSIVE streams here. The backend TimeoutServer still expires the
        // sender's `signal:` entry long after the bridge stream superseded it
        // client-side, and that late cancel must not kill the live stream
        // (a stuck active stream is the stale sweep's job).
        const ids = conv[streamId]
          ? [streamId]
          : Object.values(conv)
              .filter((st) => st.senderId === senderId && isPassivePhase(st.phase))
              .map((st) => st.streamId);
        return { streams: without(s.streams, convId, ids) };
      });
      return;
    }

    if (status === "complete") {
      const existing = get().streams[convId]?.[streamId];
      if (!existing) return;
      const completedAt = Date.now();
      set((s) => ({
        streams: {
          ...s.streams,
          [convId]: {
            ...s.streams[convId],
            [streamId]: { ...existing, completedAt, lastUpdateAt: completedAt },
          },
        },
      }));
      // Fallback: clear after the linger if new_message didn't land to clear it.
      setTimeout(() => {
        set((s) => {
          if (s.streams[convId]?.[streamId]?.completedAt !== completedAt) return s;
          return { streams: without(s.streams, convId, [streamId]) };
        });
      }, STREAM_COMPLETE_LINGER_MS);
      return;
    }

    // started or streaming

    // Signal-originated "thinking" bubbles are speculative — the agent hasn't
    // started real work yet. Suppress them entirely. The real bridge/hosted
    // stream will create the entry when processing actually begins. Signal
    // "queued" and "waiting" phases still pass through.
    const isSignalStream = streamId.startsWith("signal:");
    if (isSignalStream && phase === "thinking") {
      return;
    }

    set((s) => {
      const conv = s.streams[convId] ?? {};
      const existing = conv[streamId];
      const senderStreams = Object.values(conv).filter(
        (st) => st.senderId === senderId && st.streamId !== streamId
      );

      // A passive signal never displaces the sender's active stream (in a
      // group, InstantAgentSignal fires one frame per targeted agent).
      if (
        isPassivePhase(phase) &&
        senderStreams.some((st) => !isPassivePhase(st.phase))
      ) {
        return s;
      }

      // Preserve the previously-known senderName if this event omits it — the
      // bridge typically only sets senderName on the first frame, and falling
      // back to "Agent" mid-stream causes a name flicker. Matches mobile.
      const senderName =
        input.senderName ?? existing?.senderName ?? senderStreams[0]?.senderName ?? "Agent";

      let recentSteps = existing?.recentSteps ?? [];
      let thoughts = existing?.thoughts ?? [];
      let thoughtPrefix = existing?.thoughtPrefix ?? "";

      // Only log real phaseDetail strings (e.g. "Reading src/config.py",
      // "Searching web for …") as steps. We do NOT synthesize generic labels
      // from the phase itself — the row already shows the contract label
      // ("Thinking…" / "Using tools…"), so synthesizing those into steps
      // would just duplicate it. Matches mobile.
      const stepLabel = phaseDetail?.trim() || null;
      if (stepLabel && stepLabel !== recentSteps[recentSteps.length - 1]) {
        recentSteps = [...recentSteps, stepLabel].slice(-MAX_STREAM_STEPS);
      }

      // The bridge emits cumulative content (each writing event is the full
      // transcript-so-far). Reconstruct what it has emitted total: either
      // the incoming content if this event carries it, or `prefix + live
      // buffer` from this stream's existing state.
      const rawCurrent =
        input.content !== undefined
          ? content
          : existing
            ? (existing.thoughtPrefix ?? "") + (existing.content ?? "")
            : "";

      // When phase transitions away from `writing`, snapshot the new portion
      // of the buffer (everything past `thoughtPrefix`) onto thoughts, then
      // advance the prefix so future writing events strip it cleanly. This
      // preserves prose the agent emitted before pivoting to a tool call.
      const phaseChanged = existing?.phase === "writing" && phase !== "writing";
      if (phaseChanged) {
        if (!isFinalDeliveryToolPhase(phase, phaseDetail)) {
          const newPortion = rawCurrent.startsWith(thoughtPrefix)
            ? rawCurrent.slice(thoughtPrefix.length)
            : rawCurrent;
          const trimmed = newPortion.trim();
          if (
            trimmed &&
            trimmed.length >= MIN_THOUGHT_CHARS &&
            trimmed !== thoughts[thoughts.length - 1]
          ) {
            thoughts = [...thoughts.slice(-(MAX_STREAM_THOUGHTS - 1)), trimmed];
          }
        }
        thoughtPrefix = rawCurrent;
      }

      // Live content buffer for display: only the post-prefix portion during
      // writing; empty in non-writing phases for a clean indicator. When the
      // `stream_text` flag is OFF we keep the stream (for the phase indicator)
      // but never surface text. Mirrors mobile.
      const updatedContent =
        phase === "writing" && streamTextEnabled()
          ? rawCurrent.startsWith(thoughtPrefix)
            ? rawCurrent.slice(thoughtPrefix.length)
            : rawCurrent
          : "";

      const now = Date.now();
      // An active stream supersedes the sender's other streams here (its
      // passive signal, or an earlier stream whose terminal frame was
      // missed). A passive frame only ever adds itself.
      const superseded = isPassivePhase(phase)
        ? []
        : senderStreams.map((st) => st.streamId);
      // Keep the sender's original start so the dock row doesn't jump when
      // the signal hands over to the bridge stream.
      const startedAt =
        existing?.startedAt ??
        senderStreams.reduce<number | undefined>(
          (min, st) => (min === undefined || st.startedAt < min ? st.startedAt : min),
          undefined
        ) ??
        now;

      const base = without(s.streams, convId, superseded);
      return {
        streams: {
          ...base,
          [convId]: {
            ...(base[convId] ?? {}),
            [streamId]: {
              streamId,
              senderId,
              senderName,
              content: updatedContent,
              phase,
              phaseDetail,
              recentSteps,
              thoughts,
              thoughtPrefix,
              startedAt,
              lastUpdateAt: now,
            },
          },
        },
      };
    });
  },

  initWsListeners: () => {
    const unsub = ws.on("conv:message_streaming", (payload) => {
      const convId = payload._conversationId as string;
      get().handleStreamEvent(convId, {
        streamId: payload.streamId as string,
        senderId: payload.senderId as string,
        senderName: payload.senderName as string | undefined,
        status: payload.status as string,
        phase: payload.phase as StreamPhase | undefined,
        phaseDetail: payload.phaseDetail as string | undefined,
        content: payload.content as string | undefined,
      });
    });

    const staleTimer = setInterval(() => {
      const now = Date.now();
      set((s) => {
        let next = s.streams;
        for (const [convId, conv] of Object.entries(s.streams)) {
          const stale = Object.values(conv)
            .filter((st) => now - st.lastUpdateAt > STALE_STREAM_MS)
            .map((st) => st.streamId);
          next = without(next, convId, stale);
        }
        return next === s.streams ? s : { streams: next };
      });
    }, STREAM_SWEEP_INTERVAL_MS);

    return () => {
      unsub();
      clearInterval(staleTimer);
    };
  },
}));
