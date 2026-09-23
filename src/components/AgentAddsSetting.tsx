import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useChatStore } from "../stores/chatStore";
import type { Conversation } from "../lib/api";

/** Mirrors the server's rule: a room admin, or — for a thread — an admin
 *  of the conversation it branched from (a thread's own admin is usually
 *  the agent that opened it). Member role, not `createdBy`. */
export function canEditAgentAdds(
  conversation: Conversation,
  parent: Conversation | undefined,
  userId: string | undefined
): boolean {
  if (!userId) return false;
  const isAdmin = (c?: Conversation) =>
    !!c?.members?.some((m) => m.participantId === userId && m.role === "admin");
  return isAdmin(conversation) || isAdmin(parent);
}

/**
 * The room's "agents add agents without asking" switch
 * (docs/reference/agent-member-adds.md). Off: an agent that @mentions a
 * non-member raises an approval card instead of pulling them in. Read-only
 * for anyone the server would refuse; the server is the gate.
 */
export function AgentAddsSetting({
  conversation,
  canEdit,
}: {
  conversation: Conversation;
  canEdit: boolean;
}) {
  const { t } = useTranslation("chat");
  const setAgentAdds = useChatStore((s) => s.setAgentsAddWithoutAsking);
  const [saving, setSaving] = useState(false);
  const on = conversation.agentsAddWithoutAsking === true;

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await setAgentAdds(conversation.id, next);
    } catch {
      // Store already rolled back; the switch shows the real state.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm">{t("details.agentAdds.label")}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {on ? t("details.agentAdds.hintOn") : t("details.agentAdds.hintOff")}
        </div>
      </div>
      <Switch
        checked={on}
        disabled={!canEdit || saving}
        onCheckedChange={toggle}
        aria-label={t("details.agentAdds.label")}
      />
    </div>
  );
}
