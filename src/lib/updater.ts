// Desktop self-update. Talks to tauri-plugin-updater, which fetches the signed
// `latest.json` published by the release workflow
// (.github/workflows/release.yml) to the GitHub Release, verifies its minisign
// signature against `plugins.updater.pubkey` in tauri.conf.json, then downloads
// and swaps the bundle in place.
//
// This module is the state machine only — UpdateToast.tsx renders it. Keeping
// them apart means the toast can be previewed with fabricated state and the
// check can run before any component mounts.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** How often a long-running window re-checks. Desktop apps stay open for days,
 *  so a launch-only check would never see a release shipped mid-session. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

/** Versions the user said "Later" to. Persisted so dismissing 0.11.0 doesn't
 *  re-toast on every relaunch — but 0.12.0 still will. */
const DISMISSED_KEY = "agentchat:updateDismissed";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string; notes: string | null }
  | { phase: "downloading"; version: string; percent: number | null }
  | { phase: "ready"; version: string }
  | { phase: "failed"; version: string; message: string };

type Listener = (state: UpdateState) => void;

let state: UpdateState = { phase: "idle" };
let pending: Update | null = null;
const listeners = new Set<Listener>();

function emit(next: UpdateState): void {
  state = next;
  for (const l of listeners) l(state);
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeToUpdates(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

function rememberDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Private-mode / blocked storage: the toast simply reappears next launch.
  }
}

/**
 * Ask the endpoint whether a newer build exists. Silent on every failure —
 * a flaky network or a release not yet published is the normal case, not an
 * error worth putting in front of the user.
 */
export async function checkForUpdate(): Promise<void> {
  // Don't interrupt an install that's already in flight.
  if (state.phase === "downloading" || state.phase === "ready") return;

  let update: Update | null = null;
  try {
    update = await check();
  } catch {
    return;
  }

  if (!update) return;
  if (isDismissed(update.version)) {
    // `Update` holds a Rust-side resource; dropping the handle without
    // closing it leaks one per check, and checks repeat every few hours.
    void update.close().catch(() => {});
    return;
  }

  pending = update;
  emit({
    phase: "available",
    version: update.version,
    notes: update.body?.trim() || null,
  });
}

/**
 * Download and install the pending update.
 *
 * Platform split, straight from the plugin: on macOS this replaces the `.app`
 * bundle and returns, so we surface a "restart to finish" step. On Windows it
 * hands off to the NSIS installer and the process exits — nothing after the
 * await runs there, and the "ready" phase is simply never seen.
 */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update) return;

  emit({ phase: "downloading", version: update.version, percent: null });

  let contentLength = 0;
  let downloaded = 0;

  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? 0;
          emit({
            phase: "downloading",
            version: update.version,
            percent: contentLength > 0 ? 0 : null,
          });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          emit({
            phase: "downloading",
            version: update.version,
            // Some servers omit Content-Length; show a spinner, not a lying bar.
            percent:
              contentLength > 0
                ? Math.min(100, Math.round((downloaded / contentLength) * 100))
                : null,
          });
          break;
        case "Finished":
          emit({ phase: "ready", version: update.version });
          break;
      }
    });
  } catch (e) {
    emit({
      phase: "failed",
      version: update.version,
      message: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  emit({ phase: "ready", version: update.version });
}

/** Restart into the freshly installed build. */
export async function restartIntoUpdate(): Promise<void> {
  await relaunch();
}

/** "Later" — hide the toast and don't re-offer this exact version. */
export function dismissUpdate(): void {
  if (state.phase === "available" || state.phase === "failed") {
    rememberDismissed(state.version);
  }
  // "Not now" after a finished install keeps the installed build on disk; it
  // takes effect on the next launch either way.
  void pending?.close().catch(() => {});
  pending = null;
  emit({ phase: "idle" });
}

let started = false;

/**
 * Kick off the launch check and the recurring one. Idempotent — React strict
 * mode double-mounts, and a second interval would double every check.
 */
export function startUpdateChecks(): () => void {
  if (started) return () => {};
  started = true;

  void checkForUpdate();
  const timer = setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    started = false;
  };
}
