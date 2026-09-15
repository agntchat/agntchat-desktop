import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ws } from "../services/websocket";
import { useChatStore } from "../stores/chatStore";

interface BusyNotice {
  agentId: string;
  agentName?: string;
  parentConversationId: string;
  workConversationId: string;
  taskId: string;
  taskTitle?: string;
}

/**
 * Shows when the user sends into a parent DM while the target agent
 * is busy on a subtask. The backend holds the message (stamping it
 * `metadata.awaiting_agent`, which the bubble renders as "waiting for
 * X") and redelivers it when the task closes; this toast explains the
 * hold and offers the work room for anyone who can't wait.
 */
export function AgentBusyToast() {
  const [notice, setNotice] = useState<BusyNotice | null>(null);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  useEffect(() => {
    const unsub = ws.on("agent_busy_redirect", (payload) => {
      setNotice(payload as unknown as BusyNotice);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 7_000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!notice) return null;

  const open = () => {
    setActiveConversation(notice.workConversationId);
    setNotice(null);
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 max-w-sm">
      <AgentBusyToastCard
        name={notice.agentName}
        taskTitle={notice.taskTitle}
        onOpen={open}
        onDismiss={() => setNotice(null)}
      />
    </div>
  );
}

/** Presentational card for {@link AgentBusyToast} — split out so the component
 *  preview gallery can render it with sample data. */
export function AgentBusyToastCard({
  name,
  taskTitle,
  onOpen,
  onDismiss,
}: {
  name?: string;
  taskTitle?: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("chat");
  const displayName = name ?? t("agentBusy.defaultAgentName");

  return (
    <div className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg">
      <p className="text-sm font-medium">{t("agentBusy.title", { name: displayName })}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {taskTitle
          ? t("agentBusy.bodyTask", { task: taskTitle })
          : t("agentBusy.bodyGeneric")}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onOpen}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("agentBusy.openWorkRoom")}
        </button>
        <button
          onClick={onDismiss}
          className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          {t("common:dismiss")}
        </button>
      </div>
    </div>
  );
}
