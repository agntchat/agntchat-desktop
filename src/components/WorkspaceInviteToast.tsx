import { useEffect, useRef, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ws } from "../services/websocket";
import { useWorkspaceStore } from "../stores/workspaceStore";

/** Wire payload of `pending_invite_received` on the user channel. */
interface InviteEvent {
  inviteId: string;
  organizationId: string;
  organizationName?: string | null;
  role?: string | null;
  invitedByName?: string | null;
}

/**
 * Live "you've been invited" prompt. When an admin invites this account's
 * email while the app is open, the backend pushes `pending_invite_received`
 * with the workspace name, role, and inviter; this renders it as a toast
 * with Accept / Decline so joining doesn't require finding the switcher's
 * banner (or the email). Accept goes through `workspaceStore.acceptInvite`,
 * so the backend switches the active workspace and the store re-keys
 * exactly as the banner path does.
 *
 * The toast is dropped when the invite leaves `pendingInvites` — resolved
 * from the banner, another device, or a revoke — so it can never offer an
 * invite that no longer exists. Mounted once in AppShell.
 */
export function WorkspaceInviteToast() {
  const { t } = useTranslation("settings");
  const [invites, setInvites] = useState<InviteEvent[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pendingInvites = useWorkspaceStore((s) => s.pendingInvites);
  const acceptInvite = useWorkspaceStore((s) => s.acceptInvite);
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

  const resolve = async (id: string, action: "accept" | "decline") => {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      if (action === "accept") await acceptInvite(id);
      else await declineInvite(id);
      remove(id);
    } catch (e) {
      const fallback =
        action === "accept" ? t("workspace.acceptFailed") : t("workspace.declineFailed");
      setErrors((errs) => ({
        ...errs,
        [id]: e instanceof Error && e.message ? e.message : fallback,
      }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  if (invites.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-2">
      {invites.map((invite) => {
        const workspace = invite.organizationName || t("workspace.fallbackName");
        const body = invite.invitedByName
          ? t("workspace.inviteToast.body", { inviter: invite.invitedByName, workspace })
          : t("workspace.inviteToast.bodyNoInviter", { workspace });
        const role = invite.role
          ? t(`workspace.roles.${invite.role}`, { defaultValue: invite.role })
          : null;

        return (
          <div
            key={invite.inviteId}
            role="status"
            className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                <Mail size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("workspace.inviteToast.title")}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{body}</p>
                {role && <p className="mt-1 text-xs text-muted-foreground">{role}</p>}
                {errors[invite.inviteId] && (
                  <p className="mt-1 text-xs text-destructive">{errors[invite.inviteId]}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(invite.inviteId)}
                aria-label={t("common:dismiss")}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy[invite.inviteId]}
                onClick={() => void resolve(invite.inviteId, "decline")}
                className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                {t("workspace.declineInvite")}
              </button>
              <button
                type="button"
                disabled={busy[invite.inviteId]}
                onClick={() => void resolve(invite.inviteId, "accept")}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy[invite.inviteId] && <Loader2 size={12} className="animate-spin" />}
                {t("common:accept")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
