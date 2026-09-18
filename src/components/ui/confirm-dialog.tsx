import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConfirmStore } from "../../stores/confirmStore";

/**
 * The app's one confirmation prompt, rendered off `confirmStore` so any call
 * site can `await confirmDialog({...})` — or `alertDialog({...})` for a
 * one-button message — without threading a modal through its component tree.
 * Mounted once, at the App root.
 *
 * This replaces `window.confirm` everywhere in the desktop client — see
 * `confirmDialog` for why the native one cannot be used here at all.
 *
 * Cancel is the first focusable control so Enter on a freshly-opened prompt
 * never confirms a destructive action; Escape and the overlay both cancel.
 */
export function ConfirmDialog() {
  const { t } = useTranslation("common");
  const pending = useConfirmStore((s) => s.pending);
  const settle = useConfirmStore((s) => s.settle);

  // Hold the last request so the copy doesn't vanish mid close-animation.
  const lastRef = useRef(pending);
  if (pending) lastRef.current = pending;
  const shown = pending ?? lastRef.current;
  if (!shown) return null;

  const answer = (value: boolean) => settle(shown.id, value);

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {shown.destructive && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
            )}
            {shown.title}
          </DialogTitle>
          {shown.description && (
            <DialogDescription>{shown.description}</DialogDescription>
          )}
        </DialogHeader>

        <DialogFooter>
          {shown.kind !== "alert" && (
            <Button variant="outline" onClick={() => answer(false)}>
              {shown.cancelLabel ?? t("cancel")}
            </Button>
          )}
          <Button
            // An alert's only button dismisses a message — it never carries
            // out the destructive thing, so it stays neutral and the warning
            // icon does the signalling.
            variant={shown.destructive && shown.kind !== "alert" ? "destructive" : "default"}
            onClick={() => answer(true)}
          >
            {shown.confirmLabel ?? t(shown.kind === "alert" ? "ok" : "confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
