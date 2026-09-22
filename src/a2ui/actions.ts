import { postJson } from "./host";
import type { SurfaceTarget } from "./shared";

/**
 * The typed action return leg of an A2UI surface:
 * `POST /api/messages/:id/actions` for a chat card, the mirror
 * `POST /api/surfaces/:id/actions` for a canvas surface
 * (docs/reference/a2ui-surfaces.md § Actions). Completions live in the
 * surface's own data model, never in `metadata.cta_completions`.
 */

/** The completion the server stamps into a surface's data model at
 *  `/items/<item_index>/actions/<action_id>` (first press wins). `result` is
 *  the executed function's outcome (`sent`, `saved`) or `relayed` for an
 *  event the agent received. */
export interface SurfaceActionStamp {
  participant_id?: string;
  completed_at?: string;
  result?: string;
}

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
