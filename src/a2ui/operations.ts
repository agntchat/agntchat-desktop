import type { Message } from "./host";

/**
 * The A2UI operations a `Surface` message carries in
 * `contentStructured.data.operations`: the three the compiler emits
 * (createSurface, updateComponents, updateDataModel `/`) followed by the
 * completion stamps the action endpoint appends over time
 * (updateDataModel `/items/<n>/actions/<id>`). Replayed in order on a cold
 * load; appended live by `surface_update`.
 */
export type SurfaceOperation = Record<string, unknown>;

/** The operations inside `content_structured.data`, or null when the row
 *  does not carry a renderable surface (then the plain `content` shows). */
export function surfaceOperations(message: Message): SurfaceOperation[] | null {
  const data = message.contentStructured?.data;
  const ops = data && typeof data === "object" ? (data as { operations?: unknown }).operations : undefined;
  return Array.isArray(ops) && ops.length > 0 ? (ops as SurfaceOperation[]) : null;
}

function dataModelWrite(op: SurfaceOperation): { key: string; value: unknown } | null {
  const update = op.updateDataModel;
  if (!update || typeof update !== "object") return null;
  const { surfaceId, path, value } = update as { surfaceId?: unknown; path?: unknown; value?: unknown };
  return typeof path === "string" ? { key: `${typeof surfaceId === "string" ? surfaceId : ""}#${path}`, value } : null;
}

/** Operations are plain JSON, so a serialized compare is exact. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** When an action stamp was written (`completed_at`, else `started_at`). */
function stampTime(value: unknown): number {
  if (!value || typeof value !== "object") return NaN;
  const v = value as { completed_at?: unknown; started_at?: unknown };
  const at = typeof v.completed_at === "string" ? v.completed_at : typeof v.started_at === "string" ? v.started_at : undefined;
  return at ? Date.parse(at) : NaN;
}

/**
 * Append `incoming` to `existing` without double-applying a write. The
 * newest write to a `surfaceId#path` is its state, so an incoming write is
 * skipped when it repeats that state (the presser's optimistic copy, then
 * the same op as `surface_update`) or is an action stamp OLDER than it (the
 * `pending` broadcast arriving after the presser already applied `ok`). A
 * new state — `pending`, then `ok` or `error`; a canvas toggle flipped
 * twice — is kept. Returns `existing` itself when nothing is new, so
 * callers can no-op on identity.
 */
export function mergeSurfaceOperations(
  existing: SurfaceOperation[],
  incoming: SurfaceOperation[]
): SurfaceOperation[] {
  const last = new Map<string, unknown>();
  for (const op of existing) {
    const write = dataModelWrite(op);
    if (write) last.set(write.key, write.value);
  }
  const fresh: SurfaceOperation[] = [];
  for (const op of incoming) {
    if (!op || typeof op !== "object") continue;
    const write = dataModelWrite(op);
    if (write) {
      if (last.has(write.key)) {
        const current = last.get(write.key);
        if (sameValue(current, write.value)) continue;
        if (stampTime(write.value) < stampTime(current)) continue;
      }
      last.set(write.key, write.value);
    }
    fresh.push(op);
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}
