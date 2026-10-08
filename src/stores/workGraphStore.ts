import { create } from "zustand";
import { request } from "../lib/api";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";

/** Node kinds the server names (`Agentchat.WorkGraph.node_kinds/0`). */
export type GraphNodeKind =
  | "human"
  | "agent"
  | "conversation"
  | "huddle"
  | "work_room"
  | "task"
  | "routine"
  | "loop"
  | "reminder"
  | "artifact"
  | "goal";

/** Edge kinds the server names (`Agentchat.WorkGraph.edge_kinds/0`). */
export type GraphEdgeKind =
  | "owns"
  | "member"
  | "child_of"
  | "anchored"
  | "assigned"
  | "delegated"
  | "depends_on"
  | "subtask"
  | "works_in"
  | "runs"
  | "reports_to"
  | "lives_in"
  | "source"
  | "set_by"
  | "targets"
  | "produced"
  | "in"
  | "goal_of"
  | "owned_by";

/**
 * One node of the work graph (`GET /api/me/work-graph`). `id` is
 * `<kind>:<rowId>`; the rest of the fields are the row's, camelCased, and
 * differ by kind (a task has `assignedTo`, a routine `agentId`, …).
 */
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  rowId: string;
  label: string | null;
  status: string | null;
  subtype?: string | null;
  avatarUrl?: string | null;
  ownerId?: string | null;
  description?: string | null;
  runtime?: string | null;
  viewerRole?: string | null;
  memberCount?: number;
  parentId?: string | null;
  goal?: string | null;
  conversationId?: string | null;
  assignedTo?: string[];
  deadline?: string | null;
  source?: string | null;
  agentId?: string | null;
  reportTo?: string | null;
  schedule?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  stopReason?: string | null;
  iterationCount?: number;
  nextIterationAt?: string | null;
  remindAt?: string | null;
  eventDate?: string | null;
  recurring?: boolean;
  targetTaskId?: string | null;
  authorId?: string | null;
  version?: number;
  ownerIds?: string[];
  progressNote?: string | null;
  updatedAt?: string | null;
  lastTouchedAt?: string | null;
}

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
}

export interface WorkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeKinds: GraphNodeKind[];
  edgeKinds: GraphEdgeKind[];
  generatedAt: string;
}

export type Position = { x: number; y: number };

/** One saved arrangement (`Agentchat.WorkGraph.Layouts`): the workspace's or mine. */
export interface SavedLayout {
  scope: "mine" | "workspace";
  positions: Record<string, Position>;
  collapsed: string[];
  updatedById: string | null;
  updatedAt: string;
}

/** A pending decision (`GET /api/me/decisions`, the `work_surfaces` flag), as the graph needs it. */
export interface GraphDecision {
  kind: string;
  id: string;
  sourceId: string;
  conversationId: string | null;
  taskId: string | null;
  agent: { id: string; displayName: string | null } | null;
  insertedAt: string;
  prompt?: string;
  description?: string | null;
  question?: string | null;
  label?: string;
  title?: string;
  merchantName?: string | null;
  toolName?: string;
}

interface WorkGraphState {
  graph: WorkGraph | null;
  loading: boolean;
  error: boolean;
  /** The workspace's shared arrangement and my own, from the server. */
  layout: { workspace: SavedLayout | null; mine: SavedLayout | null };
  /** My own pins and folds, as last saved or about to be (debounced). */
  minePositions: Record<string, Position>;
  mineCollapsed: Set<string> | null;
  layoutDirty: boolean;
  hiddenKinds: Set<GraphNodeKind>;
  query: string;
  selectedId: string | null;
  /** Focus mode: 0 = off, else dim everything more than N hops from the selection. */
  focusDepth: 0 | 1 | 2;
  /** Room nodes opened in place as a live conversation (phase 3). */
  openChats: Set<string>;
  decisions: GraphDecision[];
  fetchGraph: () => Promise<void>;
  fetchDecisions: () => Promise<void>;
  /** Effective positions: mine over the workspace's. */
  positions: () => Record<string, Position>;
  /** Effective folded set: mine if I have one, else the workspace's. */
  collapsed: () => Set<string>;
  setPosition: (id: string, pos: Position) => void;
  toggleCollapsed: (id: string) => void;
  collapseAll: (ids: string[]) => void;
  expandAll: () => void;
  /** Forget my own arrangement; the workspace's shows again. */
  resetLayout: () => Promise<void>;
  /** Save what I see as the workspace's shared arrangement. */
  saveWorkspaceLayout: () => Promise<void>;
  toggleKind: (kind: GraphNodeKind) => void;
  setQuery: (q: string) => void;
  select: (id: string | null) => void;
  cycleFocus: () => void;
  toggleChat: (id: string) => void;
  closeChat: (id: string) => void;
  initWsListeners: () => () => void;
}

export const useWorkGraphEnabled = () =>
  useAuthStore((s) => s.participant?.features?.work_graph === true);

/** User-channel events after which the graph may have changed. Every kind has one. */
const REFRESH_EVENTS = [
  "task_created",
  "task_updated",
  "task_assigned",
  "task_completed",
  "new_conversation",
  "conversation_deleted",
  "removed_from_conversation",
  "conversation_metadata_changed",
  "conversation_title_changed",
  "agent_created",
  "agent_updated",
  "agent_deleted",
  "agent_deactivated",
  "reminder_fired",
  "routine_updated",
  "artifact_changed",
  "room_goals_changed",
  "user_channel_joined",
] as const;

/** Events after which the pending-decision set may have changed (mirrors the web decision store). */
const DECISION_EVENTS = [
  "permission_request",
  "permission_resolved",
  "credential_request",
  "credential_request_resolved",
  "agent_updated",
  "task_updated",
  "task_auto_blocked",
] as const;

function decisionBearing(payload: Record<string, unknown>): boolean {
  const last = payload.lastMessage as
    | { contentType?: string; messageType?: string; metadata?: Record<string, unknown> }
    | undefined;
  if (!last) return false;
  if (last.contentType === "approval_request" || last.contentType === "approval_response") return true;
  if (last.messageType === "SpendRequest") return true;
  return Boolean(last.metadata?.member_add_request_id || last.metadata?.spend_request_id);
}

const REFRESH_DEBOUNCE_MS = 800;
const LAYOUT_SAVE_DEBOUNCE_MS = 1200;

let saveTimer: number | undefined;
/** Bumped on every local layout change; a save only clears `layoutDirty` if nothing changed since it was sent. */
let layoutRev = 0;

/**
 * The work graph (`work_graph` flag): the workspace as nodes and edges,
 * read in one call and re-read after the events that change it. Layout is
 * workspace state (phase 3): the shared arrangement everyone starts from,
 * and my own pins and folds on top, saved to the server as I make them.
 */
export const useWorkGraphStore = create<WorkGraphState>((set, get) => ({
  graph: null,
  loading: false,
  error: false,
  layout: { workspace: null, mine: null },
  minePositions: {},
  mineCollapsed: null,
  layoutDirty: false,
  hiddenKinds: new Set<GraphNodeKind>(),
  query: "",
  selectedId: null,
  focusDepth: 0,
  openChats: new Set<string>(),
  decisions: [],

  fetchGraph: async () => {
    if (!useAuthStore.getState().participant?.features?.work_graph) return;
    set({ loading: true });
    try {
      const [graph, layout] = await Promise.all([
        request<WorkGraph>("/api/me/work-graph"),
        request<{ workspace: SavedLayout | null; mine: SavedLayout | null }>("/api/me/work-graph/layout"),
      ]);
      // A save in flight wins over what the server had a moment ago.
      const dirty = get().layoutDirty;
      set({
        graph,
        layout,
        loading: false,
        error: false,
        minePositions: dirty ? get().minePositions : layout.mine?.positions ?? {},
        mineCollapsed: dirty ? get().mineCollapsed : layout.mine ? new Set(layout.mine.collapsed) : null,
      });
    } catch {
      set({ loading: false, error: get().graph === null });
    }
  },

  fetchDecisions: async () => {
    if (!useAuthStore.getState().participant?.features?.work_surfaces) return;
    try {
      const data = await request<{ decisions: GraphDecision[] }>("/api/me/decisions");
      set({ decisions: data.decisions });
    } catch {
      // Badges are context, not content.
    }
  },

  positions: () => ({ ...(get().layout.workspace?.positions ?? {}), ...get().minePositions }),

  collapsed: () => get().mineCollapsed ?? new Set(get().layout.workspace?.collapsed ?? []),

  setPosition: (id, pos) => {
    layoutRev++;
    set({ minePositions: { ...get().minePositions, [id]: pos }, layoutDirty: true });
    scheduleSave(get, set);
  },

  toggleCollapsed: (id) => {
    const next = new Set(get().collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    layoutRev++;
    set({ mineCollapsed: next, layoutDirty: true });
    scheduleSave(get, set);
  },
  collapseAll: (ids) => {
    layoutRev++;
    set({ mineCollapsed: new Set(ids), layoutDirty: true });
    scheduleSave(get, set);
  },
  expandAll: () => {
    layoutRev++;
    set({ mineCollapsed: new Set<string>(), layoutDirty: true });
    scheduleSave(get, set);
  },

  resetLayout: async () => {
    window.clearTimeout(saveTimer);
    layoutRev++;
    set({ minePositions: {}, mineCollapsed: null, layoutDirty: false });
    try {
      await request("/api/me/work-graph/layout", { method: "DELETE" });
      set((s) => ({ layout: { ...s.layout, mine: null } }));
    } catch {
      // The next fetch reconciles.
    }
  },

  saveWorkspaceLayout: async () => {
    const body = { scope: "workspace", positions: get().positions(), collapsed: [...get().collapsed()] };
    try {
      const data = await request<{ layout: SavedLayout }>("/api/me/work-graph/layout", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      set((s) => ({ layout: { ...s.layout, workspace: data.layout } }));
    } catch {
      // Left for the next attempt; the person's own layout is unchanged.
    }
  },

  toggleKind: (kind) => {
    const next = new Set(get().hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    set({ hiddenKinds: next });
  },

  setQuery: (query) => set({ query }),
  select: (selectedId) => set({ selectedId }),
  cycleFocus: () => set({ focusDepth: ((get().focusDepth + 1) % 3) as 0 | 1 | 2 }),

  toggleChat: (id) => {
    const next = new Set(get().openChats);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ openChats: next });
  },
  closeChat: (id) => {
    if (!get().openChats.has(id)) return;
    const next = new Set(get().openChats);
    next.delete(id);
    set({ openChats: next });
  },

  initWsListeners: () => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void get().fetchGraph(), REFRESH_DEBOUNCE_MS);
    };
    let decisionTimer: number | undefined;
    const scheduleDecisions = () => {
      window.clearTimeout(decisionTimer);
      decisionTimer = window.setTimeout(() => void get().fetchDecisions(), REFRESH_DEBOUNCE_MS);
    };
    const unsubs = [
      ...REFRESH_EVENTS.map((event) => ws.on(event, schedule)),
      ...DECISION_EVENTS.map((event) => ws.on(event, scheduleDecisions)),
      ws.on("conversation_updated", (payload) => {
        if (decisionBearing(payload)) scheduleDecisions();
      }),
    ];
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(decisionTimer);
      unsubs.forEach((u) => u());
    };
  },
}));

/** Debounced save of my own pins and folds (`scope: "mine"`). */
function scheduleSave(
  get: () => WorkGraphState,
  set: (partial: Partial<WorkGraphState>) => void
) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const sentRev = layoutRev;
    const body = {
      scope: "mine",
      positions: get().minePositions,
      collapsed: [...(get().mineCollapsed ?? get().collapsed())],
    };
    try {
      const data = await request<{ layout: SavedLayout }>("/api/me/work-graph/layout", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      // A change made while this save was in flight keeps the local state
      // authoritative until its own save lands.
      set({ layout: { ...get().layout, mine: data.layout }, ...(layoutRev === sentRev ? { layoutDirty: false } : {}) });
    } catch {
      // Keep the local state; the next change retries.
    }
  }, LAYOUT_SAVE_DEBOUNCE_MS);
}
