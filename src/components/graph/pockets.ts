import type { GraphEdge, GraphNode, GraphNodeKind } from "../../stores/workGraphStore";

/**
 * Pockets: an agent folded together with what it runs (routines, loops,
 * reminders), a room folded together with what hangs off it (huddles, work
 * rooms, goals, artifacts). A folded satellite disappears from the canvas
 * and every edge that touched it is re-routed to its host, so the picture
 * keeps its connections while losing its clutter. Pure functions over the
 * server's graph — the server knows nothing about folding.
 */

export const GROUP_HOST_KINDS: GraphNodeKind[] = ["agent", "conversation"];

/** Which node a satellite folds into, if any. */
export function hostOf(node: GraphNode): string | null {
  switch (node.kind) {
    case "routine":
    case "loop":
    case "reminder":
      return node.agentId ? `agent:${node.agentId}` : null;
    case "huddle":
    case "work_room":
      return node.parentId ? `conversation:${node.parentId}` : null;
    case "goal":
    case "artifact":
      return node.conversationId ? `conversation:${node.conversationId}` : null;
    default:
      return null;
  }
}

export interface Folded {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** host id → satellite counts by kind (what the host's chips show). */
  satellites: Record<string, Partial<Record<GraphNodeKind, number>>>;
  /** host id → ids folded into it (so selecting a host can list them). */
  members: Record<string, string[]>;
}

/** Count every host's satellites, folded or not — the chevron shows what folding would hide. */
export function satelliteCounts(nodes: GraphNode[]): Record<string, Partial<Record<GraphNodeKind, number>>> {
  const out: Record<string, Partial<Record<GraphNodeKind, number>>> = {};
  for (const n of nodes) {
    const host = hostOf(n);
    if (!host) continue;
    const bucket = (out[host] ??= {});
    bucket[n.kind] = (bucket[n.kind] ?? 0) + 1;
  }
  return out;
}

export function fold(nodes: GraphNode[], edges: GraphEdge[], collapsed: Set<string>): Folded {
  const hidden = new Map<string, string>(); // satellite id → host id
  const members: Record<string, string[]> = {};
  const satellites: Record<string, Partial<Record<GraphNodeKind, number>>> = {};

  for (const n of nodes) {
    const host = hostOf(n);
    if (!host || !collapsed.has(host)) continue;
    hidden.set(n.id, host);
    (members[host] ??= []).push(n.id);
    const bucket = (satellites[host] ??= {});
    bucket[n.kind] = (bucket[n.kind] ?? 0) + 1;
  }

  const kept = nodes.filter((n) => !hidden.has(n.id));
  const keptIds = new Set(kept.map((n) => n.id));

  const seen = new Set<string>();
  const outEdges: GraphEdge[] = [];
  for (const e of edges) {
    const source = hidden.get(e.source) ?? e.source;
    const target = hidden.get(e.target) ?? e.target;
    if (source === target) continue; // an edge inside the pocket
    if (!keptIds.has(source) || !keptIds.has(target)) continue;
    const rerouted = source !== e.source || target !== e.target;
    const id = rerouted ? `${e.kind}|${source}|${target}` : e.id;
    if (seen.has(id)) continue;
    seen.add(id);
    outEdges.push(rerouted ? { ...e, id, source, target } : e);
  }

  return { nodes: kept, edges: outEdges, satellites, members };
}

/** Node ids within `depth` hops of `start` over `edges` (undirected). */
export function neighbourhood(start: string, edges: GraphEdge[], depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const seen = new Set<string>([start]);
  let frontier = [start];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return seen;
}
