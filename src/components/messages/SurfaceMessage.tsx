import { useMemo } from "react";
import type { Message } from "../../lib/api";
import { MarkdownContent } from "./MarkdownContent";
import { useChatStore } from "../../stores/chatStore";
import { surfaceOperations } from "../../a2ui/operations";
import { SurfaceView, useSurfaceProcessor } from "../../a2ui/render";
import type { SurfaceHost } from "../../a2ui/shared";
import "../../a2ui/surface.css";

/**
 * A `Surface` message: the backend compiled an A2UI surface (createSurface,
 * updateComponents, updateDataModel) from a result presentation, and this
 * renders it with the agntchat catalog (`src/a2ui/`, synced from the web
 * client). One processor per message row
 * (`useSurfaceProcessor`): the completion stamps the action endpoint appends
 * later (`surface_update`, or the presser's optimistic copy) arrive as
 * further operations on the same row and are fed as a tail, so bound
 * components update in place — no flash. Anything unrenderable falls back
 * to the row's text.
 */
export function SurfaceMessage({ message }: { message: Message }) {
  const operations = surfaceOperations(message);
  const { surfaces, feed } = useSurfaceProcessor(operations, message.id);

  const host = useMemo<SurfaceHost>(
    () => ({
      target: { kind: "message", id: message.id },
      conversationId: message.conversationId,
      applyOperations: (ops) => {
        // The store is the one writer: appending there re-renders this row
        // and the tail effect feeds the processor, and the later broadcast
        // of the same stamp dedupes against it. A row the store does not
        // hold (nothing to re-render) is fed directly.
        const stored = useChatStore.getState().appendSurfaceOperations(message.conversationId, message.id, ops);
        if (!stored) feed(ops);
      },
    }),
    // `feed` is a stable forwarder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.id, message.conversationId]
  );

  if (surfaces.length === 0) {
    return message.content?.trim() ? <MarkdownContent content={message.content} /> : null;
  }

  return <SurfaceView host={host} surfaces={surfaces} />;
}
