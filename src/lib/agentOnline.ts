import type { ManagedAgent } from "../stores/agentStore";

/** How long a just-started local bridge counts as online before its first
 *  presence heartbeat — bridge warmup plus executor registration. The stall
 *  detector uses the same window before it starts judging a new process. */
export const LOCAL_START_GRACE_MS = 90_000;

/** A local subprocess this desktop started less than LOCAL_START_GRACE_MS
 *  ago. Process start time, not "is the process alive": a bridge that is
 *  running but never connects (a rejected credential, a wedged startup) must
 *  stop reading as online once the window closes. */
export function inLocalStartWindow(
  managed: ManagedAgent,
  now: number = Date.now()
): boolean {
  return (
    managed.agent.runtime !== "org_host" &&
    managed.processStatus === "running" &&
    managed.startedAt != null &&
    now - managed.startedAt < LOCAL_START_GRACE_MS
  );
}

/**
 * Canonical "is this agent online right now" — the SINGLE source of truth
 * shared by every surface (the rail counter in AppShell, the Agents-tab
 * header count in Dashboard, the per-row presence dots) so they can never
 * drift apart (issue #64) — and so they agree with the conversation header,
 * which reads presence alone.
 *
 * Online = live WS presence (`presenceStore.online` — the authoritative
 * signal every client counts), OR a local subprocess still inside its
 * pre-heartbeat window (`inLocalStartWindow`). The window exists so a start
 * doesn't look like a no-op for the ~60s before the executor's first
 * presence heartbeat lands; past it, presence alone decides. Org-host agents
 * have no local subprocess (their bridge lives on a remote VM), so they are
 * presence-only.
 *
 * `presenceOnline` is `presenceStore.online` — passed in so this stays a
 * pure function (no store import, no React hook rules), callable from
 * `useMemo`, plain filters, and non-component code alike.
 */
export function isAgentOnline(
  managed: ManagedAgent,
  presenceOnline: Set<string>
): boolean {
  return presenceOnline.has(managed.agent.id) || inLocalStartWindow(managed);
}
