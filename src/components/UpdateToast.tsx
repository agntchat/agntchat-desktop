import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine, RefreshCw, TriangleAlert } from "lucide-react";

import {
  dismissUpdate,
  getUpdateState,
  installUpdate,
  restartIntoUpdate,
  startUpdateChecks,
  subscribeToUpdates,
  type UpdateState,
} from "../lib/updater";

/**
 * Offers the new desktop build when one is published. Mounted once in AppShell.
 *
 * Deliberately a toast, not a modal: an update is never urgent enough to take
 * the app away from someone mid-conversation. "Later" is remembered per
 * version, so declining 0.11.0 stays declined until 0.12.0 ships.
 */
export function UpdateToast() {
  const state = useSyncExternalStore(subscribeToUpdates, getUpdateState);

  useEffect(() => startUpdateChecks(), []);

  if (state.phase === "idle") return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 max-w-sm">
      <UpdateToastCard
        state={state}
        onInstall={() => void installUpdate()}
        onRestart={() => void restartIntoUpdate()}
        onDismiss={dismissUpdate}
      />
    </div>
  );
}

/** Presentational card for {@link UpdateToast} — split out so the component
 *  preview gallery can render each phase with fabricated state. */
export function UpdateToastCard({
  state,
  onInstall,
  onRestart,
  onDismiss,
}: {
  state: Exclude<UpdateState, { phase: "idle" }>;
  onInstall: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("common");

  const busy = state.phase === "downloading";
  const failed = state.phase === "failed";

  return (
    <div className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <div
          className={
            failed
              ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
              : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          }
        >
          {failed ? (
            <TriangleAlert size={16} />
          ) : busy ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            <ArrowDownToLine size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {state.phase === "ready"
              ? t("appUpdate.readyTitle", { version: state.version })
              : failed
                ? t("appUpdate.failedTitle")
                : t("appUpdate.availableTitle", { version: state.version })}
          </p>

          {state.phase === "available" && state.notes ? (
            // Release notes are authored by us in the GitHub Release body, but
            // render as plain text anyway — this is untrusted-shaped content
            // arriving over the network.
            <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-line text-xs text-muted-foreground">
              {state.notes}
            </p>
          ) : null}

          {state.phase === "available" && !state.notes ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("appUpdate.availableBody")}
            </p>
          ) : null}

          {state.phase === "ready" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("appUpdate.readyBody")}
            </p>
          ) : null}

          {failed ? (
            <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
          ) : null}

          {busy ? (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">
                {state.percent === null
                  ? t("appUpdate.downloading")
                  : t("appUpdate.downloadingPercent", { percent: state.percent })}
              </p>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  // Indeterminate (no Content-Length) reads as a filled sliver
                  // rather than a bar that pretends to know the answer.
                  style={{ width: `${state.percent ?? 15}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {state.phase === "ready" ? (
          <>
            <button
              onClick={onDismiss}
              className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
            >
              {t("appUpdate.restartLater")}
            </button>
            <button
              onClick={onRestart}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("appUpdate.restartNow")}
            </button>
          </>
        ) : busy ? null : (
          <>
            <button
              onClick={onDismiss}
              className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
            >
              {t("later")}
            </button>
            <button
              onClick={onInstall}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {failed ? t("retry") : t("appUpdate.install")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
