import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadAttachment } from "../../lib/downloadAttachment";

type DownloadState = "idle" | "busy" | "done" | "error";

/** Shared click handler + transient feedback for every download affordance:
 *  the overlay on an inline image, the action on a file chip, and the row
 *  button in the conversation's Files panel. */
export function useAttachmentDownload(attachmentId?: string, filename?: string) {
  const [state, setState] = useState<DownloadState>("idle");
  // The success tick reverts on a timer; clear it if the bubble unmounts
  // first (scrolled out of a virtualized list, conversation switched).
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const download = useCallback(
    async (e?: { preventDefault(): void; stopPropagation(): void }) => {
      // The chip and image wrap this button in a full-bleed "open" trigger,
      // so a download click must not also open the file.
      e?.preventDefault();
      e?.stopPropagation();
      if (!attachmentId) return;

      setState("busy");
      try {
        await downloadAttachment(attachmentId, filename);
        setState("done");
      } catch (err) {
        console.warn("[DownloadButton] download failed", err);
        setState("error");
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 2000);
    },
    [attachmentId, filename]
  );

  return { state, download };
}

export function DownloadButton({
  attachmentId,
  filename,
  className,
  variant = "plain",
}: {
  attachmentId?: string;
  filename?: string;
  className?: string;
  /** "overlay" floats on top of an image; "plain" inherits the surface. */
  variant?: "plain" | "overlay";
}) {
  const { t } = useTranslation("files");
  const { state, download } = useAttachmentDownload(attachmentId, filename);

  if (!attachmentId) return null;

  return (
    <button
      type="button"
      onClick={download}
      disabled={state === "busy"}
      title={state === "error" ? t("errors.downloadFailed") : t("common:download")}
      aria-label={t("downloadFile", { name: filename ?? t("file") })}
      className={cn(
        "relative z-20 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none",
        variant === "overlay"
          ? "bg-black/55 text-white backdrop-blur-sm hover:bg-black/75"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        state === "error" && "text-destructive",
        className
      )}
    >
      {state === "busy" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-4 w-4" />
      ) : (
        <Download className="h-4 w-4" />
      )}
    </button>
  );
}
