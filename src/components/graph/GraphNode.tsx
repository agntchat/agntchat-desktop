import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import {
  BellRing,
  Bot,
  Briefcase,
  ChevronDown,
  ChevronRight,
  FileText,
  Hash,
  ListTodo,
  MessagesSquare,
  Repeat,
  RefreshCw,
  Target,
  User,
  Users,
} from "lucide-react";
import type { GraphNode as GraphNodeData, GraphNodeKind } from "../../stores/workGraphStore";
import type { AgentActivity } from "../../lib/agent-activity";
import { AgentActivityIndicator } from "../AgentActivityIndicator";
import { cn } from "../../lib/utils";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";
import { EmbeddedChat } from "./EmbeddedChat";

/** Kinds a person can open in place as a live conversation. */
export const CHAT_KINDS: GraphNodeKind[] = ["conversation", "huddle", "work_room"];

/** Per-kind accent. Hue only — the card itself uses the theme's surfaces. */
export const KIND_COLORS: Record<GraphNodeKind, string> = {
  human: "oklch(0.72 0.14 300)",
  agent: "oklch(0.72 0.16 250)",
  conversation: "oklch(0.72 0.12 200)",
  huddle: "oklch(0.74 0.10 190)",
  work_room: "oklch(0.70 0.08 200)",
  task: "oklch(0.75 0.16 60)",
  routine: "oklch(0.72 0.14 150)",
  loop: "oklch(0.70 0.15 130)",
  reminder: "oklch(0.76 0.14 85)",
  artifact: "oklch(0.72 0.12 330)",
  goal: "oklch(0.70 0.16 20)",
};

export const KIND_ICONS: Record<GraphNodeKind, typeof Bot> = {
  human: User,
  agent: Bot,
  conversation: MessagesSquare,
  huddle: Users,
  work_room: Briefcase,
  task: ListTodo,
  routine: Repeat,
  loop: RefreshCw,
  reminder: BellRing,
  artifact: FileText,
  goal: Target,
};

/** i18n keys per kind — static so the catalog audit sees them. */
export const KIND_LABEL_KEYS: Record<GraphNodeKind, string> = {
  human: "graph:kind.human",
  agent: "graph:kind.agent",
  conversation: "graph:kind.conversation",
  huddle: "graph:kind.huddle",
  work_room: "graph:kind.workRoom",
  task: "graph:kind.task",
  routine: "graph:kind.routine",
  loop: "graph:kind.loop",
  reminder: "graph:kind.reminder",
  artifact: "graph:kind.artifact",
  goal: "graph:kind.goal",
};

/** Server enums shown on cards and in the pane, localized rather than raw. */
export const ARTIFACT_KIND_KEYS: Record<string, string> = {
  document: "graph:artifactKind.document",
  markdown: "graph:artifactKind.markdown",
  code: "graph:artifactKind.code",
  html: "graph:artifactKind.html",
  text: "graph:artifactKind.text",
};
export const SCHEDULE_KEYS: Record<string, string> = {
  interval: "graph:schedule.interval",
  cron: "graph:schedule.cron",
};
export const RUNTIME_KEYS: Record<string, string> = {
  local: "graph:runtime.local",
  org_host: "graph:runtime.orgHost",
  external: "graph:runtime.external",
};
export const STOP_REASON_KEYS: Record<string, string> = {
  awaiting_owner: "graph:stopReason.awaitingOwner",
  agent_offline: "graph:stopReason.agentOffline",
  consecutive_failures: "graph:stopReason.consecutiveFailures",
  owner_paused: "graph:stopReason.ownerPaused",
  owner_stopped: "graph:stopReason.ownerStopped",
  token_budget_exhausted: "graph:stopReason.tokenBudgetExhausted",
};

export type WorkGraphFlowNode = Node<
  {
    node: GraphNodeData;
    /** Title resolved on the client (a DM has none server-side). */
    title: string;
    dimmed: boolean;
    online?: boolean;
    activity?: AgentActivity;
    /** Satellite counts by kind: shown as chips; folded when `collapsed`. */
    satellites?: Partial<Record<GraphNodeKind, number>>;
    collapsed?: boolean;
    onToggleCollapse?: (id: string) => void;
    /** Pending decisions waiting on the person here (the `work_surfaces` inbox). */
    attention?: number;
    /** A room opened in place as a live conversation. */
    chatOpen?: boolean;
    onCloseChat?: (id: string) => void;
  },
  "work"
>;

/**
 * One node on the canvas: kind icon on the accent, the title, and a status
 * line (a task's status, a routine's schedule, a room's member count…).
 * Agents carry their live activity and presence; agents and rooms carry
 * chips for what hangs off them and a chevron that folds it away (phase 2
 * pockets). Handles on both sides so edges can enter from the left lane and
 * leave to the right one.
 */
function GraphNodeComponent({ data, selected }: NodeProps<WorkGraphFlowNode>) {
  const { t } = useTranslation("graph");
  const { node, title, dimmed, online, activity, satellites, collapsed, onToggleCollapse, attention, chatOpen, onCloseChat } =
    data;
  const Icon = KIND_ICONS[node.kind] ?? Hash;
  const color = KIND_COLORS[node.kind];

  const enumLabel = (keys: Record<string, string>, value: string | null | undefined) =>
    value ? (keys[value] ? t(keys[value]) : value) : null;

  let meta: string | null = null;
  switch (node.kind) {
    case "conversation":
      meta = `${t(`subtype.${node.subtype ?? "group"}`)} · ${t("members", { count: node.memberCount ?? 0 })}`;
      break;
    case "huddle":
      meta = node.goal ?? t("status.open");
      break;
    case "work_room":
      meta = t("kind.workRoom");
      break;
    case "task":
      meta = node.status ? t(`status.${node.status}`, { defaultValue: node.status }) : null;
      break;
    case "routine":
      meta = [
        node.status && t(`status.${node.status}`, { defaultValue: node.status }),
        enumLabel(SCHEDULE_KEYS, node.schedule),
      ]
        .filter(Boolean)
        .join(" · ");
      break;
    case "loop":
      meta = [
        node.status && t(`status.${node.status}`, { defaultValue: node.status }),
        typeof node.iterationCount === "number" ? t("iterations", { count: node.iterationCount }) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      break;
    case "reminder":
      meta = node.remindAt ? new Date(node.remindAt).toLocaleString() : null;
      break;
    case "artifact":
      meta = [enumLabel(ARTIFACT_KIND_KEYS, node.subtype), typeof node.version === "number" ? `v${node.version}` : null]
        .filter(Boolean)
        .join(" · ");
      break;
    case "goal":
      meta = node.progressNote ?? t("status.open");
      break;
    case "agent":
      meta = enumLabel(RUNTIME_KEYS, node.runtime);
      break;
    default:
      meta = null;
  }

  const satelliteEntries = Object.entries(satellites ?? {}).filter(([, n]) => (n ?? 0) > 0) as Array<
    [GraphNodeKind, number]
  >;
  const foldable = satelliteEntries.length > 0 && onToggleCollapse;

  if (chatOpen && onCloseChat) {
    return (
      <div
        style={{ borderLeftColor: color }}
        className={cn(
          "flex flex-col rounded-lg border border-border border-l-4 bg-card text-card-foreground shadow-lg",
          selected && "ring-2 ring-primary",
          dimmed && "opacity-25"
        )}
      >
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-border" />
        <EmbeddedChat conversationId={node.rowId} title={title} onClose={() => onCloseChat(node.id)} />
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-border" />
      </div>
    );
  }

  return (
    <div
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT, borderLeftColor: color }}
      className={cn(
        "relative flex flex-col rounded-lg border border-border border-l-4 bg-card text-card-foreground shadow-sm transition-opacity",
        selected && "ring-2 ring-primary",
        dimmed && "opacity-25"
      )}
    >
      {attention ? (
        <span
          className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
          title={t("attention", { count: attention })}
        >
          {attention > 99 ? "99+" : attention}
        </span>
      ) : null}
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-border" />
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: `color-mix(in oklch, ${color} 22%, transparent)`, color }}
        >
          {node.avatarUrl ? (
            <img src={node.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
          {online !== undefined && (
            <span
              aria-hidden
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                online ? "bg-primary" : "bg-muted-foreground/40"
              )}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{title}</p>
          {activity ? (
            <AgentActivityIndicator activity={activity} className="text-[11px]" iconClassName="h-3 w-3" />
          ) : (
            <p className="truncate text-[11px] text-muted-foreground">
              {t(KIND_LABEL_KEYS[node.kind])}
              {meta ? ` · ${meta}` : ""}
            </p>
          )}
        </div>
        {foldable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse!(node.id);
            }}
            className="nodrag shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={collapsed ? t("unfold") : t("fold")}
            title={collapsed ? t("unfold") : t("fold")}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {foldable && collapsed && (
        <div className="flex flex-wrap gap-1 border-t border-border px-3 py-1.5">
          {satelliteEntries.map(([kind, n]) => {
            const SatIcon = KIND_ICONS[kind];
            return (
              <span
                key={kind}
                className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title={t(KIND_LABEL_KEYS[kind])}
              >
                <SatIcon className="h-3 w-3" style={{ color: KIND_COLORS[kind] }} />
                {n}
              </span>
            );
          })}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-border" />
    </div>
  );
}

export const GraphNode = memo(GraphNodeComponent);
