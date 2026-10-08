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

interface WorkGraphState {
  graph: WorkGraph | null;
  loading: boolean;
  error: boolean;
  /** Pinned positions (dragged by hand), keyed by node id. Per viewer, in localStorage. */
  positions: Record<string, Position>;
  hiddenKinds: Set<GraphNodeKind>;
  query: string;
  selectedId: string | null;
  fetchGraph: () => Promise<void>;
  setPosition: (id: string, pos: Position) => void;
  resetLayout: () => void;
  toggleKind: (kind: GraphNodeKind) => void;
  setQuery: (q: string) => void;
  select: (id: string | null) => void;
  initWsListeners: () => () => void;
}

export const useWorkGraphEnabled = () =>
  useAuthStore((s) => s.participant?.features?.work_graph === true);

/**
 * User-channel events after which the graph may have changed. Routines have
 * no event of their own, so the view also re-reads on a slow timer while it
 * is mounted (`WorkGraphView`).
 */
const REFRESH_EVENTS = [
  "task_created",
  "task_updated",
  "task_assigned",
  "task_completed",
  "task_abandoned",
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
  "user_channel_joined",
] as const;

const REFRESH_DEBOUNCE_MS = 800;

function positionsKey(): string | null {
  const id = useAuthStore.getState().participant?.id;
  return id ? `agentchat:workGraph:positions:${id}` : null;
}

function readPositions(): Record<string, Position> {
  const key = positionsKey();
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, Position>) : {};
  } catch {
    return {};
  }
}

function writePositions(positions: Record<string, Position>) {
  const key = positionsKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(positions));
  } catch {
    // Per-viewer convenience only.
  }
}

/**
 * The work graph (`work_graph` flag): the workspace as nodes and edges,
 * read in one call and re-read after the events that change it. Layout is
 * the client's: a force layout seeds positions (`graph/layout.ts`), a drag
 * pins one here, and "reset" forgets them.
 */
export const useWorkGraphStore = create<WorkGraphState>((set, get) => ({
  graph: null,
  loading: false,
  error: false,
  positions: {},
  hiddenKinds: new Set<GraphNodeKind>(),
  query: "",
  selectedId: null,

  fetchGraph: async () => {
    if (!useAuthStore.getState().participant?.features?.work_graph) return;
    set({ loading: true });
    try {
      const graph = await request<WorkGraph>("/api/me/work-graph");
      set({ graph, loading: false, error: false, positions: readPositions() });
    } catch {
      set({ loading: false, error: get().graph === null });
    }
  },

  setPosition: (id, pos) => {
    const positions = { ...get().positions, [id]: pos };
    writePositions(positions);
    set({ positions });
  },

  resetLayout: () => {
    writePositions({});
    set({ positions: {} });
  },

  toggleKind: (kind) => {
    const next = new Set(get().hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    set({ hiddenKinds: next });
  },

  setQuery: (query) => set({ query }),
  select: (selectedId) => set({ selectedId }),

  initWsListeners: () => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void get().fetchGraph(), REFRESH_DEBOUNCE_MS);
    };
    const unsubs = REFRESH_EVENTS.map((event) => ws.on(event, schedule));
    return () => {
      window.clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  },
}));
