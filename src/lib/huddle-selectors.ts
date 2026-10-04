import type { Conversation } from "./api";

/**
 * Resolve the conversation a sourced huddle is anchored to. Sourced
 * huddles carry the parent's id either on the dedicated `parentConversationId`
 * column or, for legacy rows that predate it, inside `metadata.source_conversation_id`
 * / its camelCase variant.
 */
export function agentConversationSourceId(conversation: Conversation): string | undefined {
  const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
  return (
    conversation.parentConversationId ??
    (typeof metadata.source_conversation_id === "string"
      ? (metadata.source_conversation_id as string)
      : undefined) ??
    (typeof metadata.sourceConversationId === "string"
      ? (metadata.sourceConversationId as string)
      : undefined)
  );
}

/**
 * Pure filter: child huddles of a given parent conversation, excluding
 * the parent itself and task work-conversations (those have their own UI).
 */
export function selectChildHuddles(
  agentConversations: Conversation[] | undefined,
  parentConversationId: string
): Conversation[] {
  if (!agentConversations || agentConversations.length === 0) return [];
  return agentConversations.filter((c) => {
    if (c.id === parentConversationId || c.type === "task") return false;
    return agentConversationSourceId(c) === parentConversationId;
  });
}

/**
 * Read the huddle's lifecycle status from `metadata.huddle_status`. Defaults
 * to `"open"` for legacy huddles that pre-date the field.
 * Possible values: "open", "resolved", "abandoned".
 */
export function huddleStatus(conversation: Conversation): string {
  const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
  const status = metadata.huddle_status ?? metadata.huddleStatus;
  return typeof status === "string" ? status : "open";
}

export function isResolvedHuddle(conversation: Conversation): boolean {
  const s = huddleStatus(conversation);
  return s === "resolved" || s === "abandoned";
}

/**
 * Pull the huddle's topic from metadata (if it was opened with one).
 */
export function huddleTopic(conversation: Conversation): string | null {
  const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
  const topic = metadata.huddle_topic ?? metadata.huddleTopic;
  if (typeof topic !== "string") return null;
  const trimmed = topic.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * `true` when the conversation is a huddle — used to decide whether
 * to show the back-to-parent button and the in-huddle directives.
 */
export function isHuddle(conversation: Conversation | undefined | null): boolean {
  if (!conversation) return false;
  const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
  return metadata.huddle === true;
}
