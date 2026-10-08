import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import {
  BellRing,
  Bot,
  Briefcase,
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
import { cn } from "../../lib/utils";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

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

export type WorkGraphFlowNode = Node<
  {
    node: GraphNodeData;
    /** Title resolved on the client (a DM has none server-side). */
    title: string;
    dimmed: boolean;
    online?: boolean;
  },
  "work"
>;

/**
 * One node on the canvas: kind icon on the accent, the title, and a status
 * line (a task's status, a routine's schedule, a room's member count…).
 * Handles on both sides so edges can enter from the left lane and leave to
 * the right one.
 */
function GraphNodeComponent({ data, selected }: NodeProps<WorkGraphFlowNode>) {
  const { t } = useTranslation("graph");
  const { node, title, dimmed, online } = data;
  const Icon = KIND_ICONS[node.kind] ?? Hash;
  const color = KIND_COLORS[node.kind];

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
      meta = [node.status && t(`status.${node.status}`, { defaultValue: node.status }), node.schedule]
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
      meta = [node.subtype, typeof node.version === "number" ? `v${node.version}` : null]
        .filter(Boolean)
        .join(" · ");
      break;
    case "goal":
      meta = node.progressNote ?? t("status.open");
      break;
    case "agent":
      meta = node.runtime ?? null;
      break;
    default:
      meta = null;
  }

  return (
    <div
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT, borderLeftColor: color }}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-border border-l-4 bg-card px-3 py-2 text-card-foreground shadow-sm transition-opacity",
        selected && "ring-2 ring-primary",
        dimmed && "opacity-25"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-border" />
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
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
              online ? "bg-emerald-500" : "bg-muted-foreground/50"
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{title}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {t(KIND_LABEL_KEYS[node.kind])}
          {meta ? ` · ${meta}` : ""}
        </p>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-border" />
    </div>
  );
}

export const GraphNode = memo(GraphNodeComponent);
