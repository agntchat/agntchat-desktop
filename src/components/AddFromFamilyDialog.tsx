import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAgentStore } from "../stores/agentStore";
import { usePresenceStore } from "../stores/presenceStore";
import { cn } from "../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/**
 * "Add agents from other workspaces" — lets the owner pull one of their own
 * agents, currently pinned to some OTHER workspace, into `workspaceId`.
 * Port of the mobile picker (mobile/components/AddFromFamilyModal.tsx); the
 * web twin is web/src/components/AddFromFamilyDialog.tsx.
 *
 * Adding only ever widens the agent's pin set — the store appends
 * `workspaceId` to the existing ids — so the agent keeps every workspace it
 * was already in and the backend's pinned-deliveries conflict can't fire.
 */
export function AddFromFamilyDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("agents");
  const familyAgents = useAgentStore((s) => s.familyAgents);
  const familyLoading = useAgentStore((s) => s.familyLoading);
  const familyLoadedAt = useAgentStore((s) => s.familyLoadedAt);
  const fetchFamilyIfStale = useAgentStore((s) => s.fetchFamilyIfStale);
  const addAgentToWorkspace = useAgentStore((s) => s.addAgentToWorkspace);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const online = usePresenceStore((s) => s.online);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchFamilyIfStale();
  }, [fetchFamilyIfStale]);

  // Candidates: owned agents pinned to at least one workspace that isn't this
  // one. An unpinned agent (organizationIds null/empty) already follows its
  // owner into every workspace, this one included, so it is correctly
  // excluded as "already effectively a member".
  const candidates = familyAgents.filter(
    (a) =>
      Array.isArray(a.organizationIds) &&
      a.organizationIds.length > 0 &&
      !a.organizationIds.includes(workspaceId)
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    setError(null);
    try {
      for (const agentId of selected) {
        await addAgentToWorkspace(agentId, workspaceId);
      }
      // One refresh for the whole batch — this is what turns the newly
      // visible agents into full ManagedAgent rows in the list behind us.
      await fetchAgents();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("addFromFamily.addFailed"));
    } finally {
      setAdding(false);
    }
  };

  // Never loaded yet — `familyLoadedAt` stays 0 until a fetch resolves, so
  // this tells "still loading" apart from "loaded, nothing to add" and the
  // empty copy can't flash before the first response lands.
  const loadingFirst = familyLoadedAt === 0 && familyLoading;

  return (
    <Dialog open onOpenChange={(open) => !open && !adding && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addFromFamily.title")}</DialogTitle>
        </DialogHeader>

        {loadingFirst ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {t("common:loading")}
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("addFromFamily.empty")}
          </p>
        ) : (
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
            {candidates.map((agent) => {
              const checked = selected.has(agent.id);
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={adding}
                    onClick={() => toggle(agent.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
                  >
                    <span className="relative shrink-0">
                      {agent.avatarUrl ? (
                        <img
                          src={agent.avatarUrl}
                          alt=""
                          className="h-8 w-8 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                          {agent.displayName.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                      )}
                      <span
                        aria-hidden
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-popover bg-clip-padding",
                          online.has(agent.id) ? "bg-success" : "bg-muted-foreground"
                        )}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {agent.displayName}
                      </span>
                      {agent.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {agent.description}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background"
                      )}
                    >
                      {checked && <Check size={12} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <button
            type="button"
            disabled={adding}
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t("common:cancel")}
          </button>
          <button
            type="button"
            disabled={adding || selected.size === 0}
            onClick={() => void handleAdd()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {adding && <Loader2 size={12} className="animate-spin" />}
            {t("addFromFamily.addWithCount", { count: selected.size })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
