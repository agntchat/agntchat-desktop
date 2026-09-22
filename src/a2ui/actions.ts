import { postJson } from "./host";

/**
 * The typed action return leg of an A2UI surface:
 * `POST /api/messages/:id/actions` (docs/reference/a2ui-surfaces.md § Actions).
 * Completions live in the surface's own data model, never in
 * `metadata.cta_completions`.
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

/** Body of `POST /api/messages/:id/actions`, one of three forms:
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

export function postSurfaceAction(messageId: string, body: SurfaceActionBody): Promise<SurfaceActionResponse> {
  return postJson<SurfaceActionResponse>(`/api/messages/${messageId}/actions`, body);
}
