import type { ActiveStream, ConversationMember } from "./api";
import type { AgentActivity } from "./agent-activity";
import type { ConversationStreams } from "../stores/streamingStore";
import { isPassivePhase } from "../stores/streamingStore";
import type { PhaseOrActivity, StreamPhase } from "./status-contract.generated";

/**
 * One row of the in-conversation activity dock: a participant who is doing
 * something in THIS conversation right now. Built by `buildConversationActivity`
 * from three signals, deduplicated per participant:
 *
 *   stream   — a live `message_streaming` stream (richest: phase, tool
 *              detail, live text). Beats everything else for that sender.
 *   activity — the agent's global `agent_activity_changed` state, scoped to
 *              this conversation via `agentActivityConvs`. Bridges the gaps
 *              between streaming phases so a working agent never blinks out.
 *   typing   — the presence `typing_indicator` signal (humans, and agents
 *              that only send typing).
 *
 * Kept in parity across web / desktop / mobile so the dock reads identically.
 */
export interface ActivityEntry {
  participantId: string;
  name: string;
  type: "human" | "agent";
  kind: "stream" | "activity" | "typing";
  /** Stream phase or agent activity; undefined for typing. */
  phase?: PhaseOrActivity;
  /** Humanized tool label ("Reading src/config.py") when the stream has one. */
  phaseDetail?: string;
  /** The stream behind a `stream` entry — the thread renders a live bubble
   *  for the ones in the `writing` phase. */
  stream?: ActiveStream;
  /** Stream completed; the row reads "Done" until it clears. */
  done: boolean;
  /** First time this participant was seen active here — rows never reorder
   *  while active. */
  startedAt: number;
}

export interface ConversationActivityInput {
  conversationId: string;
  streams: ConversationStreams | undefined;
  typingIds: Set<string> | undefined;
  typingNames: Record<string, string>;
  typingTypes: Record<string, string>;
  agentActivity: Record<string, AgentActivity>;
  agentActivityConvs: Record<string, string[]>;
  members: ConversationMember[];
  myId: string | undefined;
  /** Sender of the latest message in the thread. An agent whose own message
   *  is the last one has visibly finished its turn — residual `working`
   *  activity must not trail after it as a stuck row. */
  lastMessageSenderId: string | undefined;
  /** Fallback display name when neither typing nor members know it. */
  fallbackName: string;
}

// First-seen timestamps per `${conversationId}:${participantId}`, so typing
// and activity rows (which carry no start time of their own) keep a stable
// position for as long as the participant stays active. Pruned whenever a
// participant drops out of the list for that conversation.
const firstSeen = new Map<string, number>();

/** Pick the stream that represents a sender: active beats passive, then the
 *  most recently updated. */
function primaryStream(streams: ActiveStream[]): ActiveStream | undefined {
  let best: ActiveStream | undefined;
  for (const st of streams) {
    if (!best) {
      best = st;
      continue;
    }
    const bestPassive = isPassivePhase(best.phase);
    const stPassive = isPassivePhase(st.phase);
    if (bestPassive && !stPassive) best = st;
    else if (bestPassive === stPassive && st.lastUpdateAt > best.lastUpdateAt) best = st;
  }
  return best;
}

export function buildConversationActivity(input: ConversationActivityInput): ActivityEntry[] {
  const {
    conversationId,
    streams,
    typingIds,
    typingNames,
    typingTypes,
    agentActivity,
    agentActivityConvs,
    members,
    myId,
    lastMessageSenderId,
    fallbackName,
  } = input;

  const memberById = new Map(members.map((m) => [m.participantId, m]));
  const nameOf = (pid: string, fromStream?: string) =>
    fromStream ||
    memberById.get(pid)?.participant?.displayName ||
    typingNames[pid] ||
    fallbackName;
  // Typing can come from anyone; a stream sender is an agent by construction
  // (POST /stream is agent-only), so streams never consult this.
  const typeOf = (pid: string): "human" | "agent" =>
    memberById.get(pid)?.participant?.type === "agent" || typingTypes[pid] === "agent"
      ? "agent"
      : "human";

  const byPid = new Map<string, ActivityEntry>();
  const now = Date.now();

  // 1. Live streams, one per sender.
  if (streams) {
    const bySender = new Map<string, ActiveStream[]>();
    for (const st of Object.values(streams)) {
      if (st.senderId === myId) continue;
      const list = bySender.get(st.senderId);
      if (list) list.push(st);
      else bySender.set(st.senderId, [st]);
    }
    for (const [pid, list] of bySender) {
      const st = primaryStream(list);
      if (!st) continue;
      const startedAt = list.reduce((min, s) => Math.min(min, s.startedAt), st.startedAt);
      byPid.set(pid, {
        participantId: pid,
        name: nameOf(pid, st.senderName),
        type: "agent",
        kind: "stream",
        phase: st.phase,
        phaseDetail: st.phaseDetail,
        stream: st,
        done: st.completedAt != null,
        startedAt,
      });
    }
  }

  // 2. Conversation-scoped agent activity for members not already streaming.
  for (const m of members) {
    const pid = m.participantId;
    if (pid === myId || byPid.has(pid)) continue;
    if (m.participant?.type !== "agent") continue;
    const activity = agentActivity[pid];
    if (!activity || activity === "waiting") continue;
    if (!(agentActivityConvs[pid] ?? []).includes(conversationId)) continue;
    if (lastMessageSenderId === pid) continue;
    byPid.set(pid, {
      participantId: pid,
      name: nameOf(pid),
      type: "agent",
      kind: "activity",
      phase: activity,
      done: false,
      startedAt: now,
    });
  }

  // 3. Typing, for anyone not already covered.
  if (typingIds) {
    for (const pid of typingIds) {
      if (pid === myId || byPid.has(pid)) continue;
      byPid.set(pid, {
        participantId: pid,
        name: nameOf(pid),
        type: typeOf(pid),
        kind: "typing",
        done: false,
        startedAt: now,
      });
    }
  }

  // Stable ordering: stamp first-seen times, prune the ones that left.
  const prefix = `${conversationId}:`;
  for (const key of firstSeen.keys()) {
    if (key.startsWith(prefix) && !byPid.has(key.slice(prefix.length))) firstSeen.delete(key);
  }
  const entries: ActivityEntry[] = [];
  for (const entry of byPid.values()) {
    const key = prefix + entry.participantId;
    const seen = firstSeen.get(key);
    const startedAt = seen === undefined ? entry.startedAt : Math.min(seen, entry.startedAt);
    if (seen === undefined || startedAt !== seen) firstSeen.set(key, startedAt);
    entries.push({ ...entry, startedAt });
  }
  entries.sort(
    (a, b) => a.startedAt - b.startedAt || a.participantId.localeCompare(b.participantId)
  );
  return entries;
}

/** Entries whose live text belongs in the thread: agents in the `writing`
 *  phase (a completed writing stream keeps its bubble through the linger so
 *  the text doesn't flash away before the real message lands). */
export function writingEntries(entries: ActivityEntry[]): ActivityEntry[] {
  return entries.filter((e) => e.kind === "stream" && e.stream != null && e.phase === "writing");
}

export interface ActivityCounts {
  working: number;
  typing: number;
  done: number;
}

export function countActivity(entries: ActivityEntry[]): ActivityCounts {
  const counts: ActivityCounts = { working: 0, typing: 0, done: 0 };
  for (const e of entries) {
    if (e.done) counts.done++;
    else if (e.kind === "typing") counts.typing++;
    else counts.working++;
  }
  return counts;
}

/** The phase a conversation ROW should preview for a conversation's streams:
 *  the most recently updated active stream, else any stream. */
export function primaryStreamPhase(streams: ConversationStreams | undefined): StreamPhase | undefined {
  if (!streams) return undefined;
  return primaryStream(Object.values(streams))?.phase;
}

export function hasLiveStream(streams: ConversationStreams | undefined): boolean {
  return streams != null && Object.keys(streams).length > 0;
}
