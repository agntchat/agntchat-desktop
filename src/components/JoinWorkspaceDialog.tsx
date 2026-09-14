import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import * as api from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceJoinStore } from "../stores/workspaceJoinStore";
import { WorkspaceTile } from "./WorkspaceInviteTile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/** The slice of an agent this dialog renders. */
interface AgentRow {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  ownerId?: string | null;
  organizationIds?: string[] | null;
}

async function loadAgents(): Promise<AgentRow[]> {
  const { agents } = await api.listAgents();
  return agents ?? [];
}

/**
 * The step between "Join" and actually joining. An all-workspaces agent
 * (no visibility pin) follows its owner into every workspace they are a
 * member of — so joining silently brings every such agent along. This
 * dialog lists them, all checked, and lets the user uncheck the ones that
 * should stay out; those are pinned to the pre-join workspaces by the
 * backend inside the accept transaction (`excludeAgentIds`). A user with
 * no all-workspaces agents never sees the dialog: the accept fires as soon
 * as the check comes back empty. Mounted once in AppShell.
 */
export function JoinWorkspaceDialog() {
  const { t } = useTranslation("settings");
  const invite = useWorkspaceJoinStore((s) => s.invite);
  const cancel = useWorkspaceJoinStore((s) => s.cancel);
  const acceptInvite = useWorkspaceStore((s) => s.acceptInvite);
  const me = useAuthStore((s) => s.participant?.id);

  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviteId = invite?.id;

  // Load the owner's top-level all-workspaces agents when an invite is
  // staged; sub-agents follow their parent's decision server-side.
  useEffect(() => {
    if (!inviteId) {
      setAgents(null);
      setExcluded(new Set());
      setError(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setAgents(null);
    setError(null);
    loadAgents()
      .then((all) => {
        if (cancelled) return;
        const rows = all.filter(
          (a) => (!me || a.ownerId === me) && !(a.organizationIds && a.organizationIds.length > 0)
        );
        setAgents(rows);
      })
      .catch(() => {
        if (!cancelled) setError(t("workspace.joinDialog.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [inviteId, me, t]);

  const join = async (excludeAgentIds: string[]) => {
    if (!inviteId) return;
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(inviteId, excludeAgentIds);
      cancel();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("workspace.acceptFailed"));
      setBusy(false);
    }
  };

  // Nothing to decide — join straight away.
  useEffect(() => {
    if (inviteId && agents && agents.length === 0 && !busy && !error) void join([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteId, agents]);

  if (!invite) return null;

  const workspace = invite.organizationName?.trim() || t("workspace.fallbackName");
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && cancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <WorkspaceTile name={workspace} avatarUrl={invite.organizationAvatarUrl} size="sm" />
            <div className="min-w-0">
              <DialogTitle>{t("workspace.joinDialog.title", { workspace })}</DialogTitle>
              {invite.invitedByName && (
                <DialogDescription>
                  {t("workspace.inviteToast.invitedBy", { inviter: invite.invitedByName })}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        {agents === null && !error ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {t("workspace.joinDialog.loading")}
          </div>
        ) : agents && agents.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {t("workspace.joinDialog.agentsHeading")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("workspace.joinDialog.agentsHint", { workspace })}
            </p>
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
              {agents.map((agent) => {
                const included = !excluded.has(agent.id);
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={included}
                      disabled={busy}
                      onClick={() => toggle(agent.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
                    >
                      {agent.avatarUrl ? (
                        <img
                          src={agent.avatarUrl}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {agent.displayName.trim().charAt(0).toUpperCase() || "?"}
                        </div>
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${included ? "text-foreground" : "text-muted-foreground line-through"}`}
                      >
                        {agent.displayName}
                      </span>
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${included ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                      >
                        {included && <Check size={12} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            disabled={busy || agents === null}
            onClick={() => void join([...excluded])}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {t("workspace.joinDialog.confirm")}
            {!busy && <ArrowRight size={12} />}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
