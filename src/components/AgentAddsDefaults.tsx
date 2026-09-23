import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import * as api from "../lib/api";

/** Conversation kinds with their own starting value, in display order.
 *  Settings keys are `agentsAddWithoutAsking<Kind>` (GET/PATCH /api/me/settings). */
const KINDS = [
  { kind: "direct", key: "agentsAddWithoutAskingDirect", labelKey: "agentAdds.kinds.direct" },
  { kind: "group", key: "agentsAddWithoutAskingGroup", labelKey: "agentAdds.kinds.group" },
  { kind: "channel", key: "agentsAddWithoutAskingChannel", labelKey: "agentAdds.kinds.channel" },
  { kind: "thread", key: "agentsAddWithoutAskingThread", labelKey: "agentAdds.kinds.thread" },
] as const;

type Settings = Record<string, boolean>;

/**
 * Per-kind defaults for a new conversation's "agents add agents without
 * asking" switch (docs/reference/agent-member-adds.md). Stamped at creation;
 * each conversation can change its own afterwards.
 */
export function AgentAddsDefaults() {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api
      .request<{ settings: Settings }>("/api/me/settings")
      .then((data) => setSettings(data.settings))
      .catch(() => setSettings({}));
  }, []);

  // Next value read from rendered state, not inside the updater — same
  // reason as NotificationsSection in Profile.tsx.
  const toggle = async (key: string) => {
    if (!settings) return;
    const next = !settings[key];
    setSettings((s) => ({ ...s, [key]: next }));
    try {
      await api.request("/api/me/settings", {
        method: "PATCH",
        body: JSON.stringify({ [key]: next }),
      });
    } catch {
      setSettings((s) => ({ ...s, [key]: !next }));
    }
  };

  if (!settings) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t("agentAdds.title")}
      </h3>
      <p className="text-xs text-muted-foreground">{t("agentAdds.description")}</p>
      <div className="space-y-1">
        {KINDS.map(({ key, labelKey }) => (
          <div key={key} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
            <p className="min-w-0 flex-1 text-sm font-medium">{t(labelKey)}</p>
            <Switch
              checked={settings[key] === true}
              onCheckedChange={() => toggle(key)}
              aria-label={t(labelKey)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
