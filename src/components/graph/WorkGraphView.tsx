import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeMouseHandler,
  type OnBeforeDelete,
  type OnConnect,
  type OnEdgesDelete,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslation } from "react-i18next";
import {
  Crosshair,
  FoldVertical,
  LocateFixed,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  Shuffle,
  UnfoldVertical,
  Waypoints,
  X,
} from "lucide-react";
import {
  useWorkGraphStore,
  type GraphDecision,
  type GraphEdge,
  type GraphEdgeKind,
  type GraphNode as GraphNodeData,
  type GraphNodeKind,
} from "../../stores/workGraphStore";
import { useChatStore } from "../../stores/chatStore";
import { useTaskStore } from "../../stores/taskStore";
import { useAgentStore } from "../../stores/agentStore";
import { useArtifactStore } from "../../stores/artifactStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useAuthStore } from "../../stores/authStore";
import { useNavStore } from "../../stores/navStore";
import { useThemeStore } from "../../stores/themeStore";
import { cn, formatRelativeShort, getConversationTitle } from "../../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ARTIFACT_KIND_KEYS,
  CHAT_KINDS,
  GraphNode,
  KIND_COLORS,
  KIND_ICONS,
  KIND_LABEL_KEYS,
  RUNTIME_KEYS,
  SCHEDULE_KEYS,
  STOP_REASON_KEYS,
  type WorkGraphFlowNode,
} from "./GraphNode";
import { layoutGraph } from "./layout";
import { GROUP_HOST_KINDS, fold, neighbourhood, satelliteCounts } from "./pockets";
import { connectWire, createRoomWith, createTaskFor, cuttable, disconnectWire, resolveWire } from "./wiring";

/** Transient outcome of a wire or a new node, shown under the toolbar. */
type Notice = { tone: "ok" | "error"; text: string };
const NOTICE_MS = 4000;

/** i18n keys for a drawn wire, by relation — static for the audit. */
const WIRED_KEYS = {
  assigned: "graph:wiring.assigned",
  member: "graph:wiring.member",
  reports_to: "graph:wiring.reportsTo",
  depends_on: "graph:wiring.dependsOn",
} as const;

const NODE_TYPES = { work: GraphNode };

/** Routines have no WebSocket event; the view re-reads on this cadence while mounted. */
const POLL_MS = 60_000;

/** Edge families: structure is quiet, work is strong, schedules dashed, outputs dotted. */
const EDGE_STYLE: Record<GraphEdgeKind, { dash?: string; strong?: boolean }> = {
  owns: {},
  member: {},
  child_of: {},
  anchored: { strong: true },
  assigned: { strong: true },
  delegated: { strong: true },
  depends_on: { strong: true, dash: "6 4" },
  subtask: { strong: true },
  works_in: { strong: true },
  runs: { dash: "6 4" },
  reports_to: { dash: "6 4" },
  lives_in: { dash: "6 4" },
  source: { dash: "6 4" },
  set_by: { dash: "2 4" },
  targets: { dash: "2 4" },
  produced: { dash: "2 4" },
  in: { dash: "2 4" },
  goal_of: { dash: "2 4" },
  owned_by: { dash: "2 4" },
};

/** i18n keys per edge kind — static so the catalog audit sees them. */
export const EDGE_LABEL_KEYS: Record<GraphEdgeKind, string> = {
  owns: "graph:edge.owns",
  member: "graph:edge.member",
  child_of: "graph:edge.childOf",
  anchored: "graph:edge.anchored",
  assigned: "graph:edge.assigned",
  delegated: "graph:edge.delegated",
  depends_on: "graph:edge.dependsOn",
  subtask: "graph:edge.subtask",
  works_in: "graph:edge.worksIn",
  runs: "graph:edge.runs",
  reports_to: "graph:edge.reportsTo",
  lives_in: "graph:edge.livesIn",
  source: "graph:edge.source",
  set_by: "graph:edge.setBy",
  targets: "graph:edge.targets",
  produced: "graph:edge.produced",
  in: "graph:edge.in",
  goal_of: "graph:edge.goalOf",
  owned_by: "graph:edge.ownedBy",
};

/** Decision kinds → the inbox's own labels (`decisions` namespace), static for the audit. */
const DECISION_KIND_KEYS: Record<string, string> = {
  permission: "decisions:kind.permission",
  credential: "decisions:kind.credential",
  approval: "decisions:kind.approval",
  member_request: "decisions:kind.memberRequest",
  loop_question: "decisions:kind.loopQuestion",
  spend: "decisions:kind.spend",
  blocked_task: "decisions:kind.blockedTask",
};

/**
 * The work graph (`work_graph` flag): the workspace as a canvas of typed
 * nodes — people, agents, rooms, huddles, work rooms, tasks, routines,
 * loops, reminders, artifacts, goals — joined by the relations the server
 * reports (`GET /api/me/work-graph`). Phase 2: agents and rooms fold their
 * satellites into pockets, focus dims what is more than a hop or two from
 * the selection, and agent nodes carry live activity and presence. Plan
 * and later phases: docs/feature-proposals/work-graph-canvas.md.
 */
export function WorkGraphView() {
  return (
    <ReactFlowProvider>
      <WorkGraphCanvas />
    </ReactFlowProvider>
  );
}

function WorkGraphCanvas() {
  const { t } = useTranslation("graph");
  const graph = useWorkGraphStore((s) => s.graph);
  const loading = useWorkGraphStore((s) => s.loading);
  const error = useWorkGraphStore((s) => s.error);
  const layout = useWorkGraphStore((s) => s.layout);
  const minePositions = useWorkGraphStore((s) => s.minePositions);
  const mineCollapsed = useWorkGraphStore((s) => s.mineCollapsed);
  const hiddenKinds = useWorkGraphStore((s) => s.hiddenKinds);
  const query = useWorkGraphStore((s) => s.query);
  const selectedId = useWorkGraphStore((s) => s.selectedId);
  const focusDepth = useWorkGraphStore((s) => s.focusDepth);
  const openChats = useWorkGraphStore((s) => s.openChats);
  const decisions = useWorkGraphStore((s) => s.decisions);
  const fetchGraph = useWorkGraphStore((s) => s.fetchGraph);
  const fetchDecisions = useWorkGraphStore((s) => s.fetchDecisions);
  const saveWorkspaceLayout = useWorkGraphStore((s) => s.saveWorkspaceLayout);
  const toggleChat = useWorkGraphStore((s) => s.toggleChat);
  const closeChat = useWorkGraphStore((s) => s.closeChat);

  // Effective layout: my pins over the workspace's, my folds if I have any.
  const positions = useMemo(
    () => ({ ...(layout.workspace?.positions ?? {}), ...minePositions }),
    [layout.workspace, minePositions]
  );
  const collapsed = useMemo(
    () => mineCollapsed ?? new Set(layout.workspace?.collapsed ?? []),
    [mineCollapsed, layout.workspace]
  );
  const setPosition = useWorkGraphStore((s) => s.setPosition);
  const resetLayout = useWorkGraphStore((s) => s.resetLayout);
  const toggleKind = useWorkGraphStore((s) => s.toggleKind);
  const setQuery = useWorkGraphStore((s) => s.setQuery);
  const select = useWorkGraphStore((s) => s.select);
  const toggleCollapsed = useWorkGraphStore((s) => s.toggleCollapsed);
  const collapseAll = useWorkGraphStore((s) => s.collapseAll);
  const expandAll = useWorkGraphStore((s) => s.expandAll);
  const cycleFocus = useWorkGraphStore((s) => s.cycleFocus);
  const initWsListeners = useWorkGraphStore((s) => s.initWsListeners);

  const conversations = useChatStore((s) => s.conversations);
  const agentConversations = useChatStore((s) => s.agentConversations);
  const online = usePresenceStore((s) => s.online);
  const agentActivity = usePresenceStore((s) => s.agentActivity);
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const theme = useThemeStore((s) => s.theme);
  const { fitView } = useReactFlow();

  // Read once on mount, after the events that change the graph while the
  // view is open, and on a slow poll (routines have no event).
  useEffect(() => {
    void fetchGraph();
    void fetchDecisions();
    const unsub = initWsListeners();
    const id = window.setInterval(() => void fetchGraph(), POLL_MS);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [fetchGraph, fetchDecisions, initWsListeners]);

  // Decisions waiting on the person, counted onto the node they belong to:
  // the room they were asked in, else the agent that asked.
  const attention = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of decisions) {
      const id = d.conversationId ? `conversation:${d.conversationId}` : d.agent ? `agent:${d.agent.id}` : null;
      if (id) out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }, [decisions]);

  // A DM has no title server-side; the chat store knows its members.
  const titleFor = useCallback(
    (node: GraphNodeData): string => {
      if (node.kind === "conversation" || node.kind === "huddle" || node.kind === "work_room") {
        const conv =
          conversations.find((c) => c.id === node.rowId) ??
          agentConversations.find((c) => c.id === node.rowId);
        if (conv) return getConversationTitle(conv, currentUserId);
      }
      return node.label?.trim() || t("untitled");
    },
    [conversations, agentConversations, currentUserId, t]
  );

  // Kind filter, then pockets: satellites of a folded host leave the canvas
  // and their edges re-route to the host.
  const filtered = useMemo(() => {
    const nodes = (graph?.nodes ?? []).filter((n) => !hiddenKinds.has(n.kind));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (graph?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }, [graph, hiddenKinds]);

  const allSatellites = useMemo(() => satelliteCounts(filtered.nodes), [filtered.nodes]);
  const folded = useMemo(() => fold(filtered.nodes, filtered.edges, collapsed), [filtered, collapsed]);
  const visibleNodes = folded.nodes;
  const visibleEdges = folded.edges;

  // Seed layout once per visible shape; pinned positions win and anchor the rest.
  const layoutRef = useRef<{ key: string; positions: Record<string, { x: number; y: number }> } | null>(null);
  const laidOut = useMemo(() => {
    const key = visibleNodes.map((n) => n.id).join("|") + "#" + Object.keys(positions).length;
    if (layoutRef.current?.key === key) return layoutRef.current.positions;
    const out = layoutGraph(visibleNodes, visibleEdges, positions);
    layoutRef.current = { key, positions: out };
    return out;
  }, [visibleNodes, visibleEdges, positions]);

  // Focus: what is near the selection, by hops over the visible edges.
  const focused = useMemo(() => {
    if (!selectedId || focusDepth === 0) return null;
    return neighbourhood(selectedId, visibleEdges, focusDepth);
  }, [selectedId, focusDepth, visibleEdges]);

  const needle = query.trim().toLowerCase();

  const computedNodes = useMemo<WorkGraphFlowNode[]>(
    () =>
      visibleNodes.map((node) => {
        const title = titleFor(node);
        const matchesQuery = needle.length === 0 || title.toLowerCase().includes(needle);
        const inFocus = !focused || focused.has(node.id);
        const host = GROUP_HOST_KINDS.includes(node.kind);
        return {
          id: node.id,
          type: "work",
          position: positions[node.id] ?? laidOut[node.id] ?? { x: 0, y: 0 },
          data: {
            node,
            title,
            dimmed: !matchesQuery || !inFocus,
            online: node.kind === "agent" ? online.has(node.rowId) : undefined,
            activity: node.kind === "agent" ? agentActivity[node.rowId] : undefined,
            satellites: host ? allSatellites[node.id] : undefined,
            collapsed: host ? collapsed.has(node.id) : undefined,
            onToggleCollapse: host ? toggleCollapsed : undefined,
            attention: attention[node.id],
            chatOpen: openChats.has(node.id),
            onCloseChat: CHAT_KINDS.includes(node.kind) ? closeChat : undefined,
          },
          selected: node.id === selectedId,
          // A room opened in place must not be folded into its parent's pocket
          // by a drag, and its handles move with its new size.
          draggable: true,
        };
      }),
    [
      visibleNodes,
      positions,
      laidOut,
      titleFor,
      needle,
      focused,
      online,
      agentActivity,
      allSatellites,
      collapsed,
      toggleCollapsed,
      attention,
      openChats,
      closeChat,
      selectedId,
    ]
  );

  // React Flow owns positions while a drag is in flight (a controlled
  // `nodes` prop alone would leave the card still until mouseup); the
  // computed set is pushed in whenever it changes, except mid-drag, when a
  // recompute (an activity tick, a new message) would snap the card back.
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkGraphFlowNode>(computedNodes);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setNodes(computedNodes);
  }, [computedNodes, setNodes]);

  // Cables are controlled too; selection has to be mirrored by hand for a
  // Delete to find the selected one.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const flowEdges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((edge) => {
        const style = EDGE_STYLE[edge.kind] ?? {};
        const touchesSelected = selectedId && (edge.source === selectedId || edge.target === selectedId);
        const inFocus = !focused || (focused.has(edge.source) && focused.has(edge.target));
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "smoothstep",
          selected: edge.id === selectedEdgeId,
          label: touchesSelected || edge.id === selectedEdgeId ? t(EDGE_LABEL_KEYS[edge.kind]) : undefined,
          labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
          labelBgStyle: { fill: "var(--card)" },
          animated: Boolean(touchesSelected) && Boolean(style.strong),
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: {
            strokeWidth: touchesSelected || edge.id === selectedEdgeId ? 2 : style.strong ? 1.5 : 1,
            strokeDasharray: style.dash,
            stroke: touchesSelected || edge.id === selectedEdgeId ? "var(--primary)" : "var(--border)",
            opacity: !inFocus ? 0.15 : selectedId && !touchesSelected ? 0.35 : 1,
          },
        };
      }),
    [visibleEdges, selectedId, selectedEdgeId, focused, t]
  );

  const onEdgesChange = useCallback(
    (changes: Array<{ type: string; id?: string; selected?: boolean }>) => {
      for (const c of changes) {
        if (c.type === "select" && c.id) setSelectedEdgeId(c.selected ? c.id : null);
      }
    },
    []
  );

  const onNodeDragStart: OnNodeDrag<WorkGraphFlowNode> = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const onNodeDragStop: OnNodeDrag<WorkGraphFlowNode> = useCallback(
    (_evt, node) => {
      draggingRef.current = false;
      setPosition(node.id, node.position);
    },
    [setPosition]
  );

  const onNodeClick: NodeMouseHandler<WorkGraphFlowNode> = useCallback(
    (_evt, node) => select(node.id),
    [select]
  );

  // Double-click: a room opens in place; an agent folds or unfolds its pocket.
  const onNodeDoubleClick: NodeMouseHandler<WorkGraphFlowNode> = useCallback(
    (_evt, node) => {
      const kind = node.data.node.kind;
      if (CHAT_KINDS.includes(kind)) toggleChat(node.id);
      else if (GROUP_HOST_KINDS.includes(kind) && allSatellites[node.id]) toggleCollapsed(node.id);
    },
    [allSatellites, toggleCollapsed, toggleChat]
  );

  const selected = useMemo(
    () => (selectedId ? graph?.nodes.find((n) => n.id === selectedId) ?? null : null),
    [graph, selectedId]
  );

  // --- Phase 4: wires by hand ------------------------------------------
  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const say = useCallback((n: Notice) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(n);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // A cable may be drawn only between nodes whose relation has an endpoint.
  const isValidConnection: IsValidConnection = useCallback(
    (c) => {
      const a = c.source ? byId.get(c.source) : undefined;
      const b = c.target ? byId.get(c.target) : undefined;
      return Boolean(a && b && resolveWire(a, b));
    },
    [byId]
  );

  const onConnect: OnConnect = useCallback(
    (c: Connection) => {
      const a = c.source ? byId.get(c.source) : undefined;
      const b = c.target ? byId.get(c.target) : undefined;
      const wire = a && b ? resolveWire(a, b) : null;
      if (!wire) {
        say({ tone: "error", text: t("wiring.cannotConnect") });
        return;
      }
      void connectWire(wire)
        .then(() => {
          say({ tone: "ok", text: t(WIRED_KEYS[wire.kind], { from: titleFor(wire.from), to: titleFor(wire.to) }) });
          return fetchGraph();
        })
        .catch((e: unknown) => say({ tone: "error", text: e instanceof Error ? e.message : t("wiring.failed") }));
    },
    [byId, say, t, titleFor, fetchGraph]
  );

  // Delete cuts the one selected cable when its relation has an inverse
  // call. Nodes are never deleted from the canvas, and a selected node does
  // not take its cables with it (React Flow would offer them all). A folded
  // cable stands for a relation on a hidden row, so only cables the server
  // itself reported can be cut.
  const serverEdgeIds = useMemo(() => new Set((graph?.edges ?? []).map((e) => e.id)), [graph]);
  const onBeforeDelete: OnBeforeDelete<WorkGraphFlowNode> = useCallback(
    async ({ nodes: nodesToDelete, edges: toDelete }) => {
      if (nodesToDelete.length > 0) return false;
      const chosen = toDelete.filter((e) => e.selected && serverEdgeIds.has(e.id));
      const serverEdges = chosen
        .map((e) => visibleEdges.find((v) => v.id === e.id))
        .filter((e): e is GraphEdge => Boolean(e));
      const allowed = serverEdges.filter((e) => cuttable(e, byId));
      if (allowed.length === 0) {
        say({ tone: "error", text: t("wiring.cannotCut") });
        return false;
      }
      return { nodes: [], edges: chosen.filter((e) => allowed.some((a) => a.id === e.id)) };
    },
    [visibleEdges, byId, serverEdgeIds, say, t]
  );

  const onEdgesDelete: OnEdgesDelete = useCallback(
    (deleted) => {
      setSelectedEdgeId(null);
      const serverEdges = deleted
        .map((e) => visibleEdges.find((v) => v.id === e.id))
        .filter((e): e is GraphEdge => Boolean(e));
      void Promise.all(serverEdges.map((e) => disconnectWire(e, byId)))
        .then(() => {
          say({ tone: "ok", text: t("wiring.cut", { count: serverEdges.length }) });
          return fetchGraph();
        })
        .catch((e: unknown) => {
          say({ tone: "error", text: e instanceof Error ? e.message : t("wiring.failed") });
          return fetchGraph();
        });
    },
    [visibleEdges, byId, say, t, fetchGraph]
  );

  // A selected satellite that gets folded away loses its selection.
  useEffect(() => {
    if (selectedId && graph && !visibleNodes.some((n) => n.id === selectedId)) select(null);
  }, [selectedId, visibleNodes, graph, select]);

  // Once the first graph lands, frame it.
  const framedRef = useRef(false);
  useEffect(() => {
    if (graph && !framedRef.current && computedNodes.length > 0) {
      framedRef.current = true;
      window.requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
    }
  }, [graph, computedNodes.length, fitView]);

  const kinds: GraphNodeKind[] = graph?.nodeKinds ?? [];
  const counts = useMemo(() => {
    const out: Partial<Record<GraphNodeKind, number>> = {};
    for (const n of graph?.nodes ?? []) out[n.kind] = (out[n.kind] ?? 0) + 1;
    return out;
  }, [graph]);

  const hostIds = useMemo(() => Object.keys(allSatellites), [allSatellites]);
  const allFolded = hostIds.length > 0 && hostIds.every((id) => collapsed.has(id));

  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 border-b border-border px-6 pt-5 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Waypoints className="h-5 w-5" />
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("hint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-9 w-56 pl-8"
              />
            </div>
            <Button
              variant={focusDepth > 0 ? "default" : "outline"}
              size="sm"
              onClick={cycleFocus}
              title={t("focusHint")}
              aria-pressed={focusDepth > 0}
            >
              <Crosshair className="h-4 w-4" />
              {focusDepth === 0 ? t("focus") : t("focusDepth", { depth: focusDepth })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (allFolded ? expandAll() : collapseAll(hostIds))}
              disabled={hostIds.length === 0}
              title={allFolded ? t("unfoldAll") : t("foldAll")}
            >
              {allFolded ? <UnfoldVertical className="h-4 w-4" /> : <FoldVertical className="h-4 w-4" />}
              {allFolded ? t("unfoldAll") : t("foldAll")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void fitView({ padding: 0.2, duration: 300 })} title={t("fit")}>
              <LocateFixed className="h-4 w-4" />
              {t("fit")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void resetLayout()} title={t("resetLayoutHint")}>
              <Shuffle className="h-4 w-4" />
              {t("resetLayout")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void saveWorkspaceLayout()} title={t("saveWorkspaceLayoutHint")}>
              <Save className="h-4 w-4" />
              {t("saveWorkspaceLayout")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void fetchGraph()} disabled={loading} title={t("refresh")}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {kinds.map((kind) => {
            const Icon = KIND_ICONS[kind];
            const hidden = hiddenKinds.has(kind);
            const count = counts[kind] ?? 0;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                aria-pressed={!hidden}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                  hidden
                    ? "border-border text-muted-foreground line-through opacity-60"
                    : "border-border-strong text-foreground"
                )}
                style={hidden ? undefined : { borderColor: KIND_COLORS[kind] }}
              >
                {Icon && <Icon className="h-3 w-3" style={{ color: KIND_COLORS[kind] }} />}
                {t(KIND_LABEL_KEYS[kind])}
                <span className="text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            colorMode={theme === "dark" ? "dark" : "light"}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={() => {
              select(null);
              setSelectedEdgeId(null);
            }}
            nodesConnectable
            isValidConnection={isValidConnection}
            onConnect={onConnect}
            onBeforeDelete={onBeforeDelete}
            onEdgesDelete={onEdgesDelete}
            deleteKeyCode="Delete"
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => KIND_COLORS[(n as WorkGraphFlowNode).data.node.kind]}
              maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
              style={{ background: "var(--card)" }}
            />
            {notice && (
              <Panel position="bottom-center">
                <div
                  role="status"
                  className={cn(
                    "rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-sm",
                    notice.tone === "error" ? "text-destructive" : "text-foreground"
                  )}
                >
                  {notice.text}
                </div>
              </Panel>
            )}
            {graph && graph.nodes.length === 0 && (
              <Panel position="top-center">
                <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                  {t("empty")}
                </div>
              </Panel>
            )}
            {error && !graph && (
              <Panel position="top-center">
                <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-destructive shadow-sm">
                  {t("loadFailed")}
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {selected && (
          <NodePanel
            node={selected}
            titleFor={titleFor}
            folded={folded.members[selected.id] ?? []}
            decisions={decisions.filter(
              (d) =>
                (d.conversationId && `conversation:${d.conversationId}` === selected.id) ||
                (!d.conversationId && d.agent && `agent:${d.agent.id}` === selected.id)
            )}
            chatOpen={openChats.has(selected.id)}
            onToggleChat={() => toggleChat(selected.id)}
            onCreated={(text) => {
              say({ tone: "ok", text });
              void fetchGraph();
            }}
            onFailed={(text) => say({ tone: "error", text })}
            onClose={() => select(null)}
          />
        )}
      </div>
    </div>
  );
}

/** Right-hand detail pane for the selected node, with one way into its own surface. */
function NodePanel({
  node,
  titleFor,
  folded,
  decisions,
  chatOpen,
  onToggleChat,
  onCreated,
  onFailed,
  onClose,
}: {
  node: GraphNodeData;
  titleFor: (node: GraphNodeData) => string;
  folded: string[];
  decisions: GraphDecision[];
  chatOpen: boolean;
  onToggleChat: () => void;
  onCreated: (text: string) => void;
  onFailed: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("graph");
  const { t: tDecisions } = useTranslation("decisions");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const ownerDm = useChatStore((s) =>
    node.kind === "agent"
      ? s.conversations.find(
          (c) =>
            c.type === "direct" &&
            (c.members ?? []).some((m) => m.participantId === node.rowId) &&
            (c.members ?? []).some((m) => m.participantId === currentUserId)
        )
      : undefined
  );

  // Phase 4b: a new task on a room (unassigned) or on an agent (in the DM
  // with it, assigned to it); a new room with an agent.
  const canCreateTask = node.kind === "conversation" || (node.kind === "agent" && Boolean(ownerDm));
  const createTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      if (node.kind === "conversation") {
        await createTaskFor({ conversationId: node.rowId, title });
      } else if (node.kind === "agent" && ownerDm) {
        await createTaskFor({ conversationId: ownerDm.id, title, assigneeId: node.rowId });
      }
      setNewTitle("");
      onCreated(t("create.taskCreated", { title }));
    } catch (e) {
      onFailed(e instanceof Error ? e.message : t("wiring.failed"));
    } finally {
      setCreating(false);
    }
  };
  const createRoom = async () => {
    setCreating(true);
    try {
      await createRoomWith({ agentId: node.rowId });
      onCreated(t("create.roomCreated", { name: titleFor(node) }));
    } catch (e) {
      onFailed(e instanceof Error ? e.message : t("wiring.failed"));
    } finally {
      setCreating(false);
    }
  };
  const setView = useNavStore((s) => s.setView);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const selectTask = useTaskStore((s) => s.selectTask);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const openViewer = useArtifactStore((s) => s.openViewer);
  const graph = useWorkGraphStore((s) => s.graph);
  const select = useWorkGraphStore((s) => s.select);
  const toggleCollapsed = useWorkGraphStore((s) => s.toggleCollapsed);
  const Icon = KIND_ICONS[node.kind];
  const title = titleFor(node);

  const openConversation = (id: string) => {
    setActiveConversation(id);
    setView("chat");
  };
  const openAgent = (id: string) => {
    void selectAgent(id);
    setView("agents");
  };

  let action: { label: string; run: () => void } | null = null;
  switch (node.kind) {
    case "conversation":
    case "huddle":
    case "work_room":
      action = { label: t("actions.openConversation"), run: () => openConversation(node.rowId) };
      break;
    case "task":
      action = {
        label: t("actions.openTask"),
        run: () => {
          selectTask(node.rowId);
          setView("tasks");
        },
      };
      break;
    case "agent":
      action = { label: t("actions.openAgent"), run: () => openAgent(node.rowId) };
      break;
    case "routine":
    case "loop":
    case "reminder":
      if (node.agentId) action = { label: t("actions.openAgent"), run: () => openAgent(node.agentId!) };
      break;
    case "artifact":
      if (node.conversationId) {
        action = {
          label: t("actions.openArtifact"),
          run: () => {
            openConversation(node.conversationId!);
            openViewer(node.rowId, node.conversationId!);
          },
        };
      }
      break;
    case "goal":
      if (node.conversationId) action = { label: t("actions.openConversation"), run: () => openConversation(node.conversationId!) };
      break;
    default:
      action = null;
  }

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);

  // Neighbours over the server's edges (not the folded ones), so the pane
  // always says what the row is really wired to.
  const neighbours = useMemo(() => {
    if (!graph) return [];
    return graph.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .map((e) => {
        const otherId = e.source === node.id ? e.target : e.source;
        const other = byId.get(otherId);
        return other ? { edge: e, other, outgoing: e.source === node.id } : null;
      })
      .filter((x): x is { edge: GraphEdge; other: GraphNodeData; outgoing: boolean } => x !== null);
  }, [graph, byId, node.id]);

  const foldedNodes = useMemo(
    () => folded.map((id) => byId.get(id)).filter((n): n is GraphNodeData => Boolean(n)),
    [folded, byId]
  );

  const enumLabel = (keys: Record<string, string>, value: string | null | undefined) =>
    value ? (keys[value] ? t(keys[value]) : value) : null;

  const facts: Array<[string, string]> = [];
  if (node.status) facts.push([t("fields.status"), t(`status.${node.status}`, { defaultValue: node.status })]);
  if (node.kind === "conversation" && node.subtype) facts.push([t("fields.type"), t(`subtype.${node.subtype}`, { defaultValue: node.subtype })]);
  if (node.kind === "artifact" && node.subtype) facts.push([t("fields.type"), enumLabel(ARTIFACT_KIND_KEYS, node.subtype) ?? node.subtype]);
  if (node.runtime) facts.push([t("fields.runtime"), enumLabel(RUNTIME_KEYS, node.runtime) ?? node.runtime]);
  if (typeof node.memberCount === "number") facts.push([t("fields.members"), String(node.memberCount)]);
  if (node.schedule) facts.push([t("fields.schedule"), enumLabel(SCHEDULE_KEYS, node.schedule) ?? node.schedule]);
  if (node.nextRunAt) facts.push([t("fields.nextRun"), new Date(node.nextRunAt).toLocaleString()]);
  if (node.lastRunAt) facts.push([t("fields.lastRun"), formatRelativeShort(node.lastRunAt)]);
  if (node.deadline) facts.push([t("fields.deadline"), new Date(node.deadline).toLocaleString()]);
  if (node.remindAt) facts.push([t("fields.remindAt"), new Date(node.remindAt).toLocaleString()]);
  if (typeof node.iterationCount === "number") facts.push([t("fields.iterations"), String(node.iterationCount)]);
  if (node.stopReason) facts.push([t("fields.stopReason"), enumLabel(STOP_REASON_KEYS, node.stopReason) ?? node.stopReason]);
  if (typeof node.version === "number") facts.push([t("fields.version"), `v${node.version}`]);
  if (node.updatedAt) facts.push([t("fields.updated"), formatRelativeShort(node.updatedAt)]);
  if (node.lastTouchedAt) facts.push([t("fields.updated"), formatRelativeShort(node.lastTouchedAt)]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: `color-mix(in oklch, ${KIND_COLORS[node.kind]} 22%, transparent)`, color: KIND_COLORS[node.kind] }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t(KIND_LABEL_KEYS[node.kind])}
          </p>
          <p className="break-words text-sm font-semibold text-foreground">{title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("closePanel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {(node.description || node.goal || node.progressNote) && (
          <p className="mb-3 whitespace-pre-wrap text-sm text-foreground/90">
            {node.description || node.goal || node.progressNote}
          </p>
        )}

        {facts.length > 0 && (
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {facts.map(([k, v]) => (
              <div key={k + v} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {foldedNodes.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("folded", { count: foldedNodes.length })}
              </p>
              <button
                type="button"
                onClick={() => toggleCollapsed(node.id)}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                {t("unfold")}
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {foldedNodes.map((other) => {
                const OtherIcon = KIND_ICONS[other.kind];
                return (
                  <li key={other.id} className="flex items-center gap-2 px-2 py-1 text-sm text-foreground">
                    <OtherIcon className="h-3.5 w-3.5 shrink-0" style={{ color: KIND_COLORS[other.kind] }} />
                    <span className="min-w-0 flex-1 truncate">{titleFor(other)}</span>
                    {other.status && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {t(`status.${other.status}`, { defaultValue: other.status })}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {decisions.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("attention", { count: decisions.length })}
            </p>
            <ul className="flex flex-col gap-1.5">
              {decisions.map((d) => (
                <li key={d.id} className="rounded-md border border-border bg-background px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {tDecisions(DECISION_KIND_KEYS[d.kind] ?? "decisions:kind.approval")}
                    {d.agent?.displayName ? ` · ${d.agent.displayName}` : ""}
                  </p>
                  <p className="line-clamp-3 text-sm text-foreground">
                    {d.prompt || d.description || d.question || d.label || d.title || d.merchantName || d.toolName || ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(canCreateTask || node.kind === "agent") && (
          <div className="mb-4 rounded-md border border-dashed border-border p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("create.title")}
            </p>
            {canCreateTask && (
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createTask();
                }}
              >
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={node.kind === "agent" ? t("create.taskForAgent") : t("create.taskInRoom")}
                  className="h-8 flex-1"
                  disabled={creating}
                />
                <Button type="submit" size="sm" disabled={creating || newTitle.trim().length === 0}>
                  {t("create.add")}
                </Button>
              </form>
            )}
            {node.kind === "agent" && (
              <Button variant="outline" size="sm" className="mt-1.5 w-full" disabled={creating} onClick={() => void createRoom()}>
                {t("create.roomWith")}
              </Button>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t("create.wireHint")}</p>
          </div>
        )}

        {neighbours.length > 0 && (
          <>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("connections", { count: neighbours.length })}
            </p>
            <ul className="flex flex-col gap-1">
              {neighbours.map(({ edge, other, outgoing }) => {
                const OtherIcon = KIND_ICONS[other.kind];
                return (
                  <li key={edge.id}>
                    <button
                      type="button"
                      onClick={() => select(other.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                    >
                      <OtherIcon className="h-3.5 w-3.5 shrink-0" style={{ color: KIND_COLORS[other.kind] }} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{titleFor(other)}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {outgoing ? "→ " : "← "}
                        {t(EDGE_LABEL_KEYS[edge.kind])}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {(action || CHAT_KINDS.includes(node.kind)) && (
        <div className="flex flex-col gap-2 border-t border-border p-3">
          {CHAT_KINDS.includes(node.kind) && (
            <Button variant="outline" className="w-full" onClick={onToggleChat}>
              <MessageSquareText className="h-4 w-4" />
              {chatOpen ? t("actions.closeHere") : t("actions.openHere")}
            </Button>
          )}
          {action && (
            <Button className="w-full" onClick={action.run}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
