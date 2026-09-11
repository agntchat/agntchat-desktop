import { useState } from "react";
import { Mail, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface Props {
  onAllResolved?: () => void;
}

/**
 * Renders inside the desktop workspace switcher dropdown when the
 * user has un-redeemed workspace invites whose email matches their
 * account. One-click accept joins the workspace; the backend switches
 * the active workspace and broadcasts `active_organization_changed`
 * (workspaceStore handles the cascade).
 *
 * The invite list lives in workspaceStore, not here — the switcher
 * TILE badges the same list, so a banner-local fetch would leave the
 * badge and the banner able to disagree. Dismiss (X) hides the banner
 * for this dropdown session only: the invite is still pending, so the
 * badge deliberately survives it.
 */
export function PendingInvitesBanner({ onAllResolved }: Props) {
  const { t } = useTranslation("settings");
  const invites = useWorkspaceStore((s) => s.pendingInvites);
  const acceptInvite = useWorkspaceStore((s) => s.acceptInvite);
  const declineInvite = useWorkspaceStore((s) => s.declineInvite);
  const [dismissed, setDismissed] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (dismissed || invites.length === 0) return null;

  async function handleAccept(inviteId: string) {
    setAcceptingId(inviteId);
    setError(null);
    try {
      await acceptInvite(inviteId);
      if (invites.length <= 1) onAllResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workspace.acceptFailed"));
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleDecline(inviteId: string) {
    setDecliningId(inviteId);
    setError(null);
    try {
      await declineInvite(inviteId);
      if (invites.length <= 1) onAllResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workspace.declineFailed"));
    } finally {
      setDecliningId(null);
    }
  }

  return (
    <div className="border-b border-border bg-primary/5 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
          <Mail className="h-3 w-3" />
          {t("workspace.pendingInvites")} ({invites.length})
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onAllResolved?.();
          }}
          aria-label={t("common:dismiss")}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-1">
        {invites.map((invite) => (
          <div
            key={invite.id}
            className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {invite.organizationName ?? t("workspace.fallbackName")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t(`workspace.roles.${invite.role}`, { defaultValue: invite.role })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDecline(invite.id)}
              disabled={decliningId === invite.id || acceptingId === invite.id}
              className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {decliningId === invite.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("workspace.declineInvite")
              )}
            </button>
            <button
              type="button"
              onClick={() => handleAccept(invite.id)}
              disabled={acceptingId === invite.id || decliningId === invite.id}
              className="rounded-md px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {acceptingId === invite.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("common:accept")
              )}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-[11px] text-muted-foreground">{error}</p>}
    </div>
  );
}
