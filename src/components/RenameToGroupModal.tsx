import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import { getConversationTitle } from "../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * "Rename to group" modal. When a DM becomes a group the server generates a
 * suggested name and pushes `conversation_rename_suggested`; this modal lets
 * the user accept, edit, or skip it, and optionally opt into auto-renaming
 * future groups. Rendered globally off `chatStore.pendingRename`; the server
 * broadcasts `conversation_rename_resolved` so answering on one device
 * dismisses it everywhere.
 *
 * The same modal is the naming step for a group the user just created
 * (origin `created`): no suggestion, the member-name fallback shows as the
 * placeholder, skipping stays local, and the "rename future groups"
 * preference is hidden since it governs DM→group transitions only.
 */
export function RenameToGroupModal() {
  const { t } = useTranslation("chat");
  const pendingRename = useChatStore((s) => s.pendingRename);
  const respondToRename = useChatStore((s) => s.respondToRename);
  const clearPendingRename = useChatStore((s) => s.clearPendingRename);
  const conversation = useChatStore((s) =>
    s.pendingRename ? s.getConversation(s.pendingRename.conversationId) : undefined
  );
  const currentUserId = useAuthStore((s) => s.participant?.id);

  const [title, setTitle] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const convId = pendingRename?.conversationId;

  useEffect(() => {
    if (pendingRename) {
      setTitle(pendingRename.suggestedTitle);
      setRemember(false);
    }
  }, [pendingRename]);

  if (!pendingRename || !convId) return null;

  const isNewGroup = pendingRename.origin === "created";

  const submit = async (action: "accept" | "skip") => {
    // A fresh group has nothing pending server-side — skipping just closes.
    if (action === "skip" && isNewGroup) {
      clearPendingRename(convId);
      return;
    }
    setSubmitting(true);
    try {
      await respondToRename(
        convId,
        action,
        action === "accept" ? title.trim() : undefined,
        remember || undefined
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canAccept = title.trim().length > 0 && !submitting;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Closing via overlay/esc counts as "skip".
        if (!open && !submitting) submit("skip");
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("renameToGroup.title")}</DialogTitle>
          <DialogDescription>
            {isNewGroup
              ? t("renameToGroup.descriptionNew")
              : t("renameToGroup.description")}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={title}
          maxLength={60}
          placeholder={
            isNewGroup && conversation
              ? getConversationTitle(conversation, currentUserId)
              : t("renameToGroup.placeholder")
          }
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAccept) submit("accept");
          }}
          autoFocus
          disabled={submitting}
        />

        {!isNewGroup && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={submitting}
            />
            {t("renameToGroup.rememberChoice")}
          </label>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => submit("skip")} disabled={submitting}>
            {t("renameToGroup.skip")}
          </Button>
          <Button onClick={() => submit("accept")} disabled={!canAccept}>
            {t("renameToGroup.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
