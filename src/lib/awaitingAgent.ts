/**
 * The backend stamps `metadata.awaiting_agent` on a human message it had to
 * hold because the conversation's sole agent was busy in a task work room
 * (`Agentchat.Messaging.AwaitingAgent`). While the stamp is present the
 * message has NOT been delivered — it is redelivered, and the stamp cleared
 * via `message_metadata_changed`, when that task closes. Bubbles render a
 * "waiting for <agent>" note off this so the hold is visible, not silent.
 */
export interface AwaitingAgentStamp {
  agent_id: string;
  agent_name?: string;
  task_id?: string;
  work_conversation_id?: string;
}

export function awaitingAgent(message: {
  metadata?: Record<string, unknown>;
}): AwaitingAgentStamp | null {
  const raw = message.metadata?.awaiting_agent;
  if (!raw || typeof raw !== "object") return null;
  const stamp = raw as Partial<AwaitingAgentStamp>;
  return typeof stamp.agent_id === "string" ? (stamp as AwaitingAgentStamp) : null;
}
