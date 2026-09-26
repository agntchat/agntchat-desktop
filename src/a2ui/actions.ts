import { postJson } from "./host";
import type { SurfaceTarget } from "./shared";

/**
 * The typed action return leg of an A2UI surface:
 * `POST /api/messages/:id/actions` for a chat card, the mirror
 * `POST /api/surfaces/:id/actions` for a canvas surface
 * (docs/reference/a2ui-surfaces.md § Actions). Completions live in the
 * surface's own data model, never in `metadata.cta_completions`.
 */

/** An action's state, stamped by the server into the surface's data model
 *  at `/items/<item_index>/actions/<action_id>`; the newest stamp at a path
 *  is the state. `result`: `pending` (running — on every device), `ok` (a
 *  backend function succeeded; `outcome` / `caption` are what its tool
 *  declares), `error` (failed; `error` says why, pressable again),
 *  `relayed` (an event the agent received), or a client-executed
 *  function's own result (`saved`). */
export interface SurfaceActionStamp {
  participant_id?: string;
  completed_at?: string;
  started_at?: string;
  result?: string;
  /** The done state's key: `surface.done.<outcome>`. */
  outcome?: string;
  /** A `surface.<caption>` line, interpolated with the action's args. */
  caption?: string;
  error?: string;
}

/** Results that are not a completion. */
export const OPEN_RESULTS = new Set(["pending", "error"]);

/** A `pending` stamp older than this is a run that died; the server lets
 *  the action run again, so the client stops showing it as running. */
export const PENDING_TTL_MS = 120_000;

/** Body of the actions endpoint, one of three forms:
 *  - `name` — an `event` the server relays to the agent as a UserAction;
 *  - `invoke` — a `functionCall` this client does not run itself
 *    (`sendEmail`, `saveDraft`, a device function it lacks): the server runs
 *    backend tools as the presser and relays the rest to the agent;
 *  - `executed` — a device function this client ran locally.
 *  `copyText` and `openUrl` never post. */
export type SurfaceActionBody =
  | {
      action_id: string;
      item_index: number;
      name: string;
      label?: string;
      context?: Record<string, unknown>;
    }
  | {
      action_id: string;
      item_index: number;
      invoke: { function: string; args: Record<string, unknown> };
    }
  | {
      action_id: string;
      item_index: number;
      executed: { function: string; result: string; detail?: string };
    };

export interface SurfaceActionResponse {
  /** The `updateDataModel` operation now appended to the surface — applied
   *  optimistically by the presser; every other client gets it as
   *  `surface_update`. Absent when the server could not complete the action. */
  operation?: Record<string, unknown> | null;
  alreadyCompleted: boolean;
  userActionMessageId?: string | null;
  /** Outcome of an `invoke`: `ok: false` carries the failure text to show
   *  in place of a done state. */
  result?: { ok: boolean; text?: string } | null;
}

export function surfaceActionsPath(target: SurfaceTarget): string {
  return target.kind === "surface" ? `/api/surfaces/${target.id}/actions` : `/api/messages/${target.id}/actions`;
}

export function postSurfaceAction(target: SurfaceTarget, body: SurfaceActionBody): Promise<SurfaceActionResponse> {
  return postJson<SurfaceActionResponse>(surfaceActionsPath(target), body);
}

/** A two-way input's write on a canvas surface: `invoke updateSurfaceData`
 *  under the component's id, one `{path, value}` per changed binding. The
 *  server applies it through `Canvases.write`, recomputes derived
 *  visibility and broadcasts `surface_update`. */
export function surfaceWriteBody(componentId: string, writes: { path: string; value: unknown }[]): SurfaceActionBody {
  return { action_id: componentId, item_index: 0, invoke: { function: "updateSurfaceData", args: { writes } } };
}
