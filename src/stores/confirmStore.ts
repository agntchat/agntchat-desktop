import { create } from "zustand";

/**
 * What a confirm prompt says. Copy comes from the i18n catalog at the call
 * site — this store never builds strings.
 */
export interface ConfirmRequest {
  /** Short heading naming the action ("Delete Conversation"). */
  title: string;
  /** The question and its consequence. Optional when the title already asks. */
  description?: string;
  /** Label on the affirmative button. Defaults to `common:confirm`. */
  confirmLabel?: string;
  /** Label on the dismissive button. Defaults to `common:cancel`. */
  cancelLabel?: string;
  /** Renders the affirmative button in the destructive style. */
  destructive?: boolean;
  /** "alert" drops the cancel button — a message to acknowledge, not a
   *  choice. Set by `alertDialog`; don't pass it directly. */
  kind?: "confirm" | "alert";
}

interface PendingConfirm extends ConfirmRequest {
  id: number;
  resolve: (answer: boolean) => void;
}

interface ConfirmState {
  pending: PendingConfirm | null;
  request: (req: ConfirmRequest) => Promise<boolean>;
  /** Answer the open prompt. Ignored if `id` is no longer the open one. */
  settle: (id: number, answer: boolean) => void;
}

let nextId = 1;

const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  request: (req) =>
    new Promise<boolean>((resolve) => {
      // Only one prompt is on screen at a time. A second request (a stray
      // double-click, a background event) supersedes the first, which
      // resolves as "cancelled" so its caller never hangs.
      get().pending?.resolve(false);
      set({ pending: { ...req, id: nextId++, resolve } });
    }),
  settle: (id, answer) =>
    set((s) => {
      if (s.pending?.id !== id) return s;
      s.pending.resolve(answer);
      return { pending: null };
    }),
}));

export { useConfirmStore };

/**
 * Ask the user to confirm an action. Resolves true only if they press the
 * affirmative button — Escape, the overlay, and Cancel all resolve false.
 *
 * ALWAYS use this instead of `window.confirm`: the Tauri dialog plugin
 * replaces `window.confirm` with an *async* function, so the classic
 * `if (!confirm(msg)) return;` guard tests a Promise (always truthy),
 * never returns, and the action fires whichever button the user pressed.
 * `scripts/check-no-native-confirm.mjs` fails the build if a native
 * `confirm()` call comes back.
 */
export function confirmDialog(req: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().request(req);
}

/**
 * Show a message with a single OK button. The desktop replacement for
 * `window.alert`, which Tauri routes to a native OS message box — off-design,
 * unstyled, and unthemed next to the rest of the app.
 *
 * Prefer an inline error slot where the surface has one; this is for the
 * failures that have nowhere else to go.
 */
export function alertDialog(req: Omit<ConfirmRequest, "kind" | "cancelLabel">): Promise<void> {
  return useConfirmStore
    .getState()
    .request({ ...req, kind: "alert" })
    .then(() => undefined);
}
