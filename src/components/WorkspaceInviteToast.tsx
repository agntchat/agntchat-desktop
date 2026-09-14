import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ws } from "../services/websocket";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceJoinStore } from "../stores/workspaceJoinStore";
import { WorkspaceTile } from "./WorkspaceInviteTile";

/** Wire payload of `pending_invite_received` on the user channel. */
interface InviteEvent {
  inviteId: string;
  organizationId: string;
  organizationName?: string | null;
  organizationAvatarUrl?: string | null;
  role?: string | null;
  invitedByName?: string | null;
}

/**
 * Live "you've been invited" prompt. When an admin invites this account's
 * email while the app is open, the backend pushes `pending_invite_received`
 * with the workspace name, avatar, role, and inviter; this renders it as a
 * card led by the workspace identity with Decline / Join, so joining
 * doesn't require finding the switcher's banner (or the email). Join goes
 * through `workspaceStore.acceptInvite`, so the backend switches the active
 * workspace and the store re-keys exactly as the banner path does.
 *
 * The card is dropped when the invite leaves `pendingInvites` — resolved
 * from the banner, another device, or a revoke — so it can never offer an
 * invite that no longer exists. Mounted once in AppShell.
 */
export function WorkspaceInviteToast() {
  const { t } = useTranslation("settings");
  const [invites, setInvites] = useState<InviteEvent[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pendingInvites = useWorkspaceStore((s) => s.pendingInvites);
  const declineInvite = useWorkspaceStore((s) => s.declineInvite);
  // Ids the store has confirmed as pending at least once; an id that was
  // confirmed and then vanishes from the list was resolved elsewhere.
  const confirmed = useRef(new Set<string>());

  useEffect(() => {
    return ws.on("pending_invite_received", (payload) => {
      const ev = payload as unknown as InviteEvent;
      if (!ev?.inviteId) return;
      setInvites((prev) =>
        prev.some((p) => p.inviteId === ev.inviteId) ? prev : [...prev, ev]
      );
    });
  }, []);

  useEffect(() => {
    const live = new Set(pendingInvites.map((i) => i.id));
    for (const id of live) confirmed.current.add(id);
    setInvites((prev) =>
      prev.filter((p) => live.has(p.inviteId) || !confirmed.current.has(p.inviteId))
    );
  }, [pendingInvites]);

  const remove = (id: string) =>
    setInvites((prev) => prev.filter((p) => p.inviteId !== id));

  const decline = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      await declineInvite(id);
      remove(id);
    } catch (e) {
      setErrors((errs) => ({
        ...errs,
        [id]: e instanceof Error && e.message ? e.message : t("workspace.declineFailed"),
      }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  // Join is a hand-off: JoinWorkspaceDialog asks which all-workspaces
  // agents come along, then accepts. The card drops once the invite
  // leaves `pendingInvites`.
  const join = (invite: InviteEvent) =>
    useWorkspaceJoinStore.getState().begin({
      id: invite.inviteId,
      organizationId: invite.organizationId,
      organizationName: invite.organizationName,
      organizationAvatarUrl: invite.organizationAvatarUrl,
      role: invite.role,
      invitedByName: invite.invitedByName,
    });

  if (invites.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[22rem] max-w-[calc(100vw-3rem)] flex-col gap-3">
      {invites.map((invite) => (
        <InviteCard
          key={invite.inviteId}
          invite={invite}
          busy={!!busy[invite.inviteId]}
          error={errors[invite.inviteId]}
          onJoin={() => join(invite)}
          onDecline={() => void decline(invite.inviteId)}
          onDismiss={() => remove(invite.inviteId)}
        />
      ))}
    </div>
  );
}

function InviteCard({
  invite,
  busy,
  error,
  onJoin,
  onDecline,
  onDismiss,
}: {
  invite: InviteEvent;
  busy: boolean;
  error?: string;
  onJoin: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("settings");
  // Slide-up + fade on mount; flipped on the frame after first paint so
  // the transition actually runs.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const workspace = invite.organizationName?.trim() || t("workspace.fallbackName");
  const lead = invite.invitedByName
    ? t("workspace.inviteToast.invitedBy", { inviter: invite.invitedByName })
    : t("workspace.inviteToast.invited");
  const role = invite.role
    ? t(`workspace.roles.${invite.role}`, { defaultValue: invite.role })
    : null;

  return (
    <div
      role="status"
      className={[
        "pointer-events-auto relative overflow-hidden rounded-2xl border border-border bg-card shadow-xl ring-1 ring-primary/10",
        "transition-all duration-300 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      ].join(" ")}
    >
      {/* Soft primary wash so the card reads as an invitation rather
          than a system notice. */}
      <div className="absolute inset-0 -z-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent" />

      <div className="relative p-4">
        <div className="flex items-start gap-3">
          <WorkspaceTile name={workspace} avatarUrl={invite.organizationAvatarUrl} size="lg" />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
              {t("workspace.inviteToast.title")}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold leading-tight text-foreground">
              {workspace}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <span className="break-words">{lead}</span>
              {role && (
                <span className="rounded-full border border-border bg-background/70 px-1.5 py-px text-[10px] font-medium text-foreground/80">
                  {role}
                </span>
              )}
            </p>
            {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("common:dismiss")}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t("workspace.declineInvite")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onJoin}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {t("workspace.inviteToast.join")}
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
