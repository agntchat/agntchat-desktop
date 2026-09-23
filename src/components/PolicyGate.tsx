import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, ShieldAlert } from "lucide-react";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import { useAuthStore } from "../stores/authStore";
import * as api from "../lib/api";
import { identifyAnalytics } from "../lib/analytics";
import { legalUrl } from "../lib/legal";
import { Button } from "@/components/ui/button";

function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

/**
 * Blocks the app until a human has accepted the current Terms and Privacy
 * Policy. The server decides (`policyReacceptRequired`, from
 * `Agentchat.Legal.accepted_current?/1`); bumping the policy version there
 * puts every existing user back behind this screen on their next load.
 */
export function PolicyGate({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation("auth");
  const participant = useAuthStore((s) => s.participant);
  const logout = useAuthStore((s) => s.logout);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (participant?.policyReacceptRequired !== true) return <>{children}</>;

  const accept = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const updated = await api.updateConsent({ reaccept: true });
      localStorage.setItem("participant", JSON.stringify(updated));
      useAuthStore.setState({ participant: updated });
      void identifyAnalytics(updated);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold text-text">{t("policyGate.title")}</h1>
            <p className="text-sm text-text-secondary">{t("policyGate.body")}</p>
          </div>
        </div>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-text">
          <li>{t("policyGate.data")}</li>
          <li>{t("policyGate.security")}</li>
          <li>{t("policyGate.agents")}</li>
        </ul>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={busy}
            className="mt-0.5 rounded border-border"
          />
          <div className="min-w-0 flex-1 text-xs leading-snug text-text">
            {t("consent.label")}{" "}
            <button
              type="button"
              onClick={() => openExternal(legalUrl("terms", i18n.resolvedLanguage))}
              className="text-primary underline hover:text-primary/80"
            >
              {t("consent.terms")}
            </button>
            <span className="text-text-secondary"> · </span>
            <button
              type="button"
              onClick={() => openExternal(legalUrl("privacy", i18n.resolvedLanguage))}
              className="text-primary underline hover:text-primary/80"
            >
              {t("consent.privacy")}
            </button>
          </div>
        </label>
        {failed && (
          <div className="rounded-md bg-danger-light px-3 py-2 text-sm text-danger" role="alert">
            {t("policyGate.failed")}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={logout} disabled={busy}>
            {t("policyGate.signOut")}
          </Button>
          <Button onClick={accept} disabled={!checked || busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("policyGate.cta")}
          </Button>
        </div>
      </div>
    </div>
  );
}
