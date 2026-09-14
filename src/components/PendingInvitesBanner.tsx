import { useState } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { WorkspaceTile } from "./WorkspaceInviteTile";

interface Props {
  /** Called after the user accepts/declines all pending invites so
   *  the parent (the switcher dropdown) can collapse the banner. */
  onAllResolved?: () => void;
}

/**
 * Renders inside the workspace switcher dropdown when the user has
 * un-redeemed workspace invites whose email matches their account.
 * Each row is led by the workspace identity (avatar or initial tile,
 * then the name) with the inviter and role beneath and Decline / Join —
 * the same card language as the live WorkspaceInviteToast. Join joins
 * the workspace; workspaceStore auto-switches to it via the backend's
 * active_organization_changed broadcast.
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (dismissed || invites.length === 0) return null;

  async function resolve(inviteId: string, action: "accept" | "decline") {
    setBusyId(inviteId);
    setError(null);
    try {
      if (action === "accept") await acceptInvite(inviteId);
      else await declineInvite(inviteId);
      if (invites.length <= 1) onAllResolved?.();
    } catch (e) {
      const fallback =
        action === "accept" ? t("workspace.acceptFailed") : t("workspace.declineFailed");
      setError(e instanceof Error && e.message ? e.message : fallback);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border-b border-border bg-gradient-to-br from-primary/[0.07] to-transparent px-3 pb-3 pt-2.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
          {t("workspace.pendingInvites")} · {invites.length}
        </p>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onAllResolved?.();
          }}
          aria-label={t("common:dismiss")}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-2">
        {invites.map((invite) => {
          const workspace = invite.organizationName?.trim() || t("workspace.fallbackName");
          const lead = invite.invitedByName
            ? t("workspace.inviteToast.invitedBy", { inviter: invite.invitedByName })
            : t("workspace.inviteToast.invited");
          const role = t(`workspace.roles.${invite.role}`, { defaultValue: invite.role });
          const busy = busyId === invite.id;

          return (
            <div
              key={invite.id}
              className="rounded-xl border border-border bg-card p-2.5 shadow-sm"
            >
              <div className="flex items-start gap-2.5">
                <WorkspaceTile name={workspace} avatarUrl={invite.organizationAvatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight text-foreground">
                    {workspace}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="break-words">{lead}</span>
                    <span className="rounded-full border border-border bg-background/70 px-1.5 py-px text-[10px] font-medium text-foreground/80">
                      {role}
                    </span>
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => void resolve(invite.id, "decline")}
                  disabled={busyId !== null}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {t("workspace.declineInvite")}
                </button>
                <button
                  type="button"
                  onClick={() => void resolve(invite.id, "accept")}
                  disabled={busyId !== null}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {t("workspace.inviteToast.join")}
                  {!busy && <ArrowRight className="h-3 w-3" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
