import type { GraphEdge, GraphNode, GraphNodeKind, Position } from "../../stores/workGraphStore";

/**
 * Seed layout for nodes nobody has dragged yet: a small force simulation
 * (repulsion between nodes, springs along edges) with each kind pulled
 * toward its own lane, so the picture reads left to right — people and
 * agents, what they run, the rooms, the work in them, what came out.
 * Pinned nodes (dragged by hand) are fixed and still exert force, so new
 * nodes settle around the arrangement the person made.
 */

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;

/** Lane index per kind — the x the layout pulls that kind toward. */
const LANES: Record<GraphNodeKind, number> = {
  human: 0,
  agent: 1,
  routine: 2,
  loop: 2,
  reminder: 2,
  conversation: 3,
  huddle: 4,
  work_room: 4,
  goal: 4,
  task: 5,
  artifact: 6,
};

const LANE_GAP = 340;
const ITERATIONS = 240;
const REPULSION = 26000;
const SPRING = 0.015;
const SPRING_LENGTH = 260;
const LANE_PULL = 0.05;
const DAMPING = 0.82;

export function laneOf(kind: GraphNodeKind): number {
  return LANES[kind] ?? 3;
}

/** Deterministic pseudo-random in [0, 1) from a string, so a reload lands the same picture. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  pinned: Record<string, Position>
): Record<string, Position> {
  const n = nodes.length;
  if (n === 0) return {};

  const index = new Map<string, number>();
  nodes.forEach((node, i) => index.set(node.id, i));

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const fixed = new Uint8Array(n);

  // Start each kind in its lane, spread vertically by a stable hash so
  // the same workspace always seeds the same way.
  const perLane = new Map<number, number>();
  nodes.forEach((node, i) => {
    const pin = pinned[node.id];
    if (pin) {
      x[i] = pin.x;
      y[i] = pin.y;
      fixed[i] = 1;
      return;
    }
    const lane = laneOf(node.kind);
    const count = perLane.get(lane) ?? 0;
    perLane.set(lane, count + 1);
    x[i] = lane * LANE_GAP + (hash01(node.id) - 0.5) * 60;
    y[i] = count * (NODE_HEIGHT + 24) + (hash01(node.id + "y") - 0.5) * 40;
  });

  const links: Array<[number, number]> = [];
  for (const e of edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }

  for (let step = 0; step < ITERATIONS; step++) {
    const cooling = 1 - step / ITERATIONS;

    // Repulsion (all pairs — the graph is capped server-side, so this is cheap enough).
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i] - x[j];
        let dy = y[i] - y[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = hash01(`${i}-${j}`) - 0.5;
          dy = hash01(`${j}-${i}`) - 0.5;
          d2 = 1;
        }
        const f = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vx[i] += fx;
        vy[i] += fy;
        vx[j] -= fx;
        vy[j] -= fy;
      }
    }

    // Springs along edges.
    for (const [a, b] of links) {
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = (d - SPRING_LENGTH) * SPRING;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vx[a] += fx;
      vy[a] += fy;
      vx[b] -= fx;
      vy[b] -= fy;
    }

    // Lane gravity on x, light centring on y.
    for (let i = 0; i < n; i++) {
      const lane = laneOf(nodes[i].kind) * LANE_GAP;
      vx[i] += (lane - x[i]) * LANE_PULL;
      vy[i] += -y[i] * 0.002;
    }

    for (let i = 0; i < n; i++) {
      if (fixed[i]) {
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] *= DAMPING;
      vy[i] *= DAMPING;
      x[i] += vx[i] * cooling;
      y[i] += vy[i] * cooling;
    }
  }

  const out: Record<string, Position> = {};
  nodes.forEach((node, i) => {
    out[node.id] = { x: Math.round(x[i]), y: Math.round(y[i]) };
  });
  return out;
}
