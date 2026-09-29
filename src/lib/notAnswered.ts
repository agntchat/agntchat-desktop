/**
 * The backend stamps `metadata.not_answered` on a human message that will
 * not be answered (`Agentchat.Messaging.NotAnswered`,
 * docs/reference/product-rules.md): the human pressed Stop after sending it
 * (`reason: "stopped"`), or the agent did not take it before its delivery
 * expired (`reason: "expired"`). Bubbles show a short note off this so an
 * unanswered message is visible, never silent.
 */
export interface NotAnsweredStamp {
  reason: "stopped" | "expired";
  agents: string[];
  at?: string;
}

export function notAnswered(message: {
  metadata?: Record<string, unknown>;
}): NotAnsweredStamp | null {
  const raw = message.metadata?.not_answered;
  if (!raw || typeof raw !== "object") return null;
  const stamp = raw as Partial<NotAnsweredStamp>;
  if (stamp.reason !== "stopped" && stamp.reason !== "expired") return null;
  return { reason: stamp.reason, agents: Array.isArray(stamp.agents) ? stamp.agents : [], at: stamp.at };
}
