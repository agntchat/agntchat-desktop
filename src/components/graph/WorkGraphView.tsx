import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslation } from "react-i18next";
import { LocateFixed, RefreshCw, Search, Shuffle, Waypoints, X } from "lucide-react";
import {
  useWorkGraphStore,
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
import { GraphNode, KIND_COLORS, KIND_ICONS, KIND_LABEL_KEYS, type WorkGraphFlowNode } from "./GraphNode";
import { layoutGraph } from "./layout";

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
const EDGE_LABEL_KEYS: Record<GraphEdgeKind, string> = {
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

/**
 * The work graph (`work_graph` flag): the workspace as a canvas of typed
 * nodes — people, agents, rooms, huddles, work rooms, tasks, routines,
 * loops, reminders, artifacts, goals — joined by the relations the server
 * reports (`GET /api/me/work-graph`). Read-only in this phase: selecting a
 * node shows its fields and one way into the surface that owns it. Plan
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
  const positions = useWorkGraphStore((s) => s.positions);
  const hiddenKinds = useWorkGraphStore((s) => s.hiddenKinds);
  const query = useWorkGraphStore((s) => s.query);
  const selectedId = useWorkGraphStore((s) => s.selectedId);
  const fetchGraph = useWorkGraphStore((s) => s.fetchGraph);
  const setPosition = useWorkGraphStore((s) => s.setPosition);
  const resetLayout = useWorkGraphStore((s) => s.resetLayout);
  const toggleKind = useWorkGraphStore((s) => s.toggleKind);
  const setQuery = useWorkGraphStore((s) => s.setQuery);
  const select = useWorkGraphStore((s) => s.select);

  const conversations = useChatStore((s) => s.conversations);
  const agentConversations = useChatStore((s) => s.agentConversations);
  const online = usePresenceStore((s) => s.online);
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const theme = useThemeStore((s) => s.theme);
  const { fitView } = useReactFlow();

  useEffect(() => {
    void fetchGraph();
    const id = window.setInterval(() => void fetchGraph(), POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchGraph]);

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

  const visibleNodes = useMemo(
    () => (graph?.nodes ?? []).filter((n) => !hiddenKinds.has(n.kind)),
    [graph, hiddenKinds]
  );

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return (graph?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [graph, visibleNodes]);

  // Seed layout once per graph shape; pinned positions win and anchor the rest.
  const layoutRef = useRef<{ key: string; positions: Record<string, { x: number; y: number }> } | null>(null);
  const laidOut = useMemo(() => {
    const key = visibleNodes.map((n) => n.id).join("|") + "#" + Object.keys(positions).length;
    if (layoutRef.current?.key === key) return layoutRef.current.positions;
    const out = layoutGraph(visibleNodes, visibleEdges, positions);
    layoutRef.current = { key, positions: out };
    return out;
  }, [visibleNodes, visibleEdges, positions]);

  const needle = query.trim().toLowerCase();

  const flowNodes = useMemo<WorkGraphFlowNode[]>(
    () =>
      visibleNodes.map((node) => {
        const title = titleFor(node);
        const dimmed = needle.length > 0 && !title.toLowerCase().includes(needle);
        return {
          id: node.id,
          type: "work",
          position: positions[node.id] ?? laidOut[node.id] ?? { x: 0, y: 0 },
          data: {
            node,
            title,
            dimmed,
            online: node.kind === "agent" ? online.has(node.rowId) : undefined,
          },
          selected: node.id === selectedId,
        };
      }),
    [visibleNodes, positions, laidOut, titleFor, needle, online, selectedId]
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((edge) => {
        const style = EDGE_STYLE[edge.kind] ?? {};
        const touchesSelected = selectedId && (edge.source === selectedId || edge.target === selectedId);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "smoothstep",
          label: touchesSelected ? t(EDGE_LABEL_KEYS[edge.kind]) : undefined,
          labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
          labelBgStyle: { fill: "var(--card)" },
          animated: Boolean(touchesSelected) && Boolean(style.strong),
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: {
            strokeWidth: touchesSelected ? 2 : style.strong ? 1.5 : 1,
            strokeDasharray: style.dash,
            stroke: touchesSelected ? "var(--primary)" : "var(--border)",
            opacity: selectedId && !touchesSelected ? 0.35 : 1,
          },
        };
      }),
    [visibleEdges, selectedId, t]
  );

  const onNodeDragStop: OnNodeDrag<WorkGraphFlowNode> = useCallback(
    (_evt, node) => setPosition(node.id, node.position),
    [setPosition]
  );

  const onNodeClick: NodeMouseHandler<WorkGraphFlowNode> = useCallback(
    (_evt, node) => select(node.id),
    [select]
  );

  const selected = useMemo(
    () => (selectedId ? graph?.nodes.find((n) => n.id === selectedId) ?? null : null),
    [graph, selectedId]
  );

  // Once the first graph lands, frame it.
  const framedRef = useRef(false);
  useEffect(() => {
    if (graph && !framedRef.current && flowNodes.length > 0) {
      framedRef.current = true;
      window.requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
    }
  }, [graph, flowNodes.length, fitView]);

  const kinds: GraphNodeKind[] = graph?.nodeKinds ?? [];
  const counts = useMemo(() => {
    const out: Partial<Record<GraphNodeKind, number>> = {};
    for (const n of graph?.nodes ?? []) out[n.kind] = (out[n.kind] ?? 0) + 1;
    return out;
  }, [graph]);

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
            <Button variant="outline" size="sm" onClick={() => void fitView({ padding: 0.2, duration: 300 })} title={t("fit")}>
              <LocateFixed className="h-4 w-4" />
              {t("fit")}
            </Button>
            <Button variant="outline" size="sm" onClick={resetLayout} title={t("resetLayout")}>
              <Shuffle className="h-4 w-4" />
              {t("resetLayout")}
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
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            colorMode={theme === "dark" ? "dark" : "light"}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={() => select(null)}
            nodesConnectable={false}
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
          <NodePanel node={selected} title={titleFor(selected)} onClose={() => select(null)} />
        )}
      </div>
    </div>
  );
}

/** Right-hand detail pane for the selected node, with one way into its own surface. */
function NodePanel({ node, title, onClose }: { node: GraphNodeData; title: string; onClose: () => void }) {
  const { t } = useTranslation("graph");
  const setView = useNavStore((s) => s.setView);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const selectTask = useTaskStore((s) => s.selectTask);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const openViewer = useArtifactStore((s) => s.openViewer);
  const graph = useWorkGraphStore((s) => s.graph);
  const select = useWorkGraphStore((s) => s.select);
  const Icon = KIND_ICONS[node.kind];

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

  // Neighbours, by edge kind, so the panel reads as "what this is wired to".
  const neighbours = useMemo(() => {
    if (!graph) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .map((e) => {
        const otherId = e.source === node.id ? e.target : e.source;
        const other = byId.get(otherId);
        return other ? { edge: e, other, outgoing: e.source === node.id } : null;
      })
      .filter((x): x is { edge: (typeof graph.edges)[number]; other: GraphNodeData; outgoing: boolean } => x !== null);
  }, [graph, node.id]);

  const facts: Array<[string, string]> = [];
  if (node.status) facts.push([t("fields.status"), t(`status.${node.status}`, { defaultValue: node.status })]);
  if (node.subtype) facts.push([t("fields.type"), node.subtype]);
  if (typeof node.memberCount === "number") facts.push([t("fields.members"), String(node.memberCount)]);
  if (node.schedule) facts.push([t("fields.schedule"), node.schedule]);
  if (node.nextRunAt) facts.push([t("fields.nextRun"), new Date(node.nextRunAt).toLocaleString()]);
  if (node.lastRunAt) facts.push([t("fields.lastRun"), formatRelativeShort(node.lastRunAt)]);
  if (node.deadline) facts.push([t("fields.deadline"), new Date(node.deadline).toLocaleString()]);
  if (node.remindAt) facts.push([t("fields.remindAt"), new Date(node.remindAt).toLocaleString()]);
  if (typeof node.iterationCount === "number") facts.push([t("fields.iterations"), String(node.iterationCount)]);
  if (node.stopReason) facts.push([t("fields.stopReason"), node.stopReason]);
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
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {other.label?.trim() || t("untitled")}
                      </span>
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

      {action && (
        <div className="border-t border-border p-3">
          <Button className="w-full" onClick={action.run}>
            {action.label}
          </Button>
        </div>
      )}
    </aside>
  );
}
