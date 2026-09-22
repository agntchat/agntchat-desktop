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

function dataModelTarget(op: SurfaceOperation): string | null {
  const update = op.updateDataModel;
  if (!update || typeof update !== "object") return null;
  const { surfaceId, path } = update as { surfaceId?: unknown; path?: unknown };
  return typeof path === "string" ? `${typeof surfaceId === "string" ? surfaceId : ""}#${path}` : null;
}

/**
 * Append `incoming` to `existing` without double-applying a stamp: the
 * presser applies the endpoint's returned operation optimistically and then
 * receives the same one as `surface_update`, so an `updateDataModel` whose
 * `path` is already present is skipped. Returns `existing` itself when
 * nothing is new, so callers can no-op on identity.
 */
export function mergeSurfaceOperations(
  existing: SurfaceOperation[],
  incoming: SurfaceOperation[]
): SurfaceOperation[] {
  const seen = new Set(existing.map(dataModelTarget).filter((k): k is string => k !== null));
  const fresh: SurfaceOperation[] = [];
  for (const op of incoming) {
    if (!op || typeof op !== "object") continue;
    const target = dataModelTarget(op);
    if (target) {
      if (seen.has(target)) continue;
      seen.add(target);
    }
    fresh.push(op);
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}
