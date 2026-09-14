/**
 * Map a seat-query API error to localized copy.
 *
 * Soul and pulse revision run on the agent's OWN model seat, not on a
 * platform API key — so "the agent is offline" is an expected outcome with
 * its own error code, not a generic failure. There is deliberately no
 * server-side fallback, so this is the only place the user learns why.
 *
 * Returns null for anything else, so callers keep their existing message.
 */
export function seatErrorMessage(
  e: unknown,
  agentName: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  ns: "soul" | "pulse"
): string | null {
  const code = (e as { code?: string } | null)?.code;
  if (code === "agent_offline") {
    return t(`${ns}.errors.agentOffline`, { name: agentName });
  }
  if (code === "agent_timeout") {
    return t(`${ns}.errors.agentTimeout`, { name: agentName });
  }
  return null;
}
