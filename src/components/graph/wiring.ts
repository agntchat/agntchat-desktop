import { request } from "../../lib/api";
import type { GraphEdge, GraphEdgeKind, GraphNode } from "../../stores/workGraphStore";

/**
 * Phase 4: wires drawn by hand. A cable dragged between two nodes is an API
 * call against the endpoint that owns that relation — never client state —
 * and the graph re-reads afterwards. Only relations with an endpoint can be
 * drawn or cut; everything else is read-only on the canvas.
 *
 *   task ↔ agent          → PATCH /api/tasks/:id {assignedTo}
 *   agent ↔ conversation  → POST /api/conversations/:id/members
 *   routine → conversation → PATCH /api/routines/:id {report_to}
 *   task → task           → PATCH /api/tasks/:id {dependsOn}   (source depends on target)
 */

export type WireKind = Extract<GraphEdgeKind, "assigned" | "member" | "reports_to" | "depends_on">;

export interface Wire {
  kind: WireKind;
  /** The two rows, in the relation's own direction (e.g. task → agent). */
  from: GraphNode;
  to: GraphNode;
}

/** What drawing a cable from `a` to `b` would mean, or null if nothing. */
export function resolveWire(a: GraphNode, b: GraphNode): Wire | null {
  const pair = (x: GraphNode["kind"], y: GraphNode["kind"]) =>
    (a.kind === x && b.kind === y) ? [a, b] : (a.kind === y && b.kind === x) ? [b, a] : null;

  const assign = pair("task", "agent");
  if (assign) return { kind: "assigned", from: assign[0], to: assign[1] };

  const member = pair("agent", "conversation");
  if (member) return { kind: "member", from: member[0], to: member[1] };

  if (a.kind === "routine" && b.kind === "conversation") return { kind: "reports_to", from: a, to: b };

  if (a.kind === "task" && b.kind === "task" && a.id !== b.id) return { kind: "depends_on", from: a, to: b };

  return null;
}

/** Draw the wire: the one call that owns the relation. Throws on failure. */
export async function connectWire(wire: Wire): Promise<void> {
  switch (wire.kind) {
    case "assigned": {
      const current = wire.from.assignedTo ?? [];
      if (current.includes(wire.to.rowId)) return;
      await request(`/api/tasks/${wire.from.rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTo: [...current, wire.to.rowId] }),
      });
      return;
    }
    case "member":
      await request(`/api/conversations/${wire.to.rowId}/members`, {
        method: "POST",
        body: JSON.stringify({ participantId: wire.from.rowId }),
      });
      return;
    case "reports_to":
      await request(`/api/routines/${wire.from.rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ report_to: wire.to.rowId }),
      });
      return;
    case "depends_on": {
      // The graph node does not carry dependsOn; read the task first so the
      // whole array (which the endpoint replaces) stays intact.
      const task = await request<{ dependsOn?: string[] }>(`/api/tasks/${wire.from.rowId}`);
      const current = task.dependsOn ?? [];
      if (current.includes(wire.to.rowId)) return;
      await request(`/api/tasks/${wire.from.rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ dependsOn: [...current, wire.to.rowId] }),
      });
      return;
    }
  }
}

/** Whether an existing edge can be cut by hand (its relation has an inverse call). */
export function cuttable(edge: GraphEdge, byId: Map<string, GraphNode>): boolean {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (!source || !target) return false;
  switch (edge.kind) {
    case "assigned":
    case "reports_to":
    case "depends_on":
      return true;
    case "member":
      // Only an agent's membership; a person leaves a room from the room.
      return source.kind === "agent";
    default:
      return false;
  }
}

/** Cut the wire: the inverse of `connectWire`. Throws on failure. */
export async function disconnectWire(edge: GraphEdge, byId: Map<string, GraphNode>): Promise<void> {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (!source || !target) return;
  switch (edge.kind) {
    case "assigned": {
      const current = source.assignedTo ?? [];
      await request(`/api/tasks/${source.rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTo: current.filter((id) => id !== target.rowId) }),
      });
      return;
    }
    case "member":
      await request(`/api/conversations/${target.rowId}/members/${source.rowId}`, { method: "DELETE" });
      return;
    case "reports_to":
      await request(`/api/routines/${source.rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ report_to: null }),
      });
      return;
    case "depends_on": {
      const task = await request<{ dependsOn?: string[] }>(`/api/tasks/${source.rowId}`);
      await request(`/api/tasks/${source.rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ dependsOn: (task.dependsOn ?? []).filter((id) => id !== target.rowId) }),
      });
      return;
    }
    default:
      return;
  }
}

/** Phase 4b: new nodes from the canvas, pre-wired to the node they were made on. */
export async function createTaskFor(opts: {
  conversationId: string;
  title: string;
  assigneeId?: string;
}): Promise<void> {
  await request(`/api/conversations/${opts.conversationId}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: opts.title,
      ...(opts.assigneeId ? { assignedTo: [opts.assigneeId] } : {}),
    }),
  });
}

export async function createRoomWith(opts: { agentId: string; title?: string }): Promise<{ id: string }> {
  return request<{ id: string }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ type: "group", memberIds: [opts.agentId], ...(opts.title ? { title: opts.title } : {}) }),
  });
}
