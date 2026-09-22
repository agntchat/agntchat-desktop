import { useEffect, useMemo, useRef, useState } from "react";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { A2uiSurface, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import type { Message } from "../../lib/api";
import { MarkdownContent } from "./MarkdownContent";
import { useChatStore } from "../../stores/chatStore";
import { agntchatCatalog } from "../../a2ui/catalog";
import { currentLocale } from "../../a2ui/host";
import { surfaceOperations, type SurfaceOperation } from "../../a2ui/operations";
import { SurfaceContext, type SurfaceHost } from "../../a2ui/shared";
import "../../a2ui/surface.css";

type Surface = SurfaceModel<ReactComponentImplementation>;

/**
 * A `Surface` message: the backend compiled an A2UI surface (createSurface,
 * updateComponents, updateDataModel) from a result presentation, and this
 * renders it with the agntchat catalog (`src/a2ui/`, synced from the web
 * client). One MessageProcessor per message row, built once and never
 * rebuilt: the completion stamps the action endpoint appends later
 * (`surface_update`, or the presser's optimistic copy) arrive as further
 * operations on the same row and are fed to the existing processor as a
 * tail, so bound components update in place — no flash. On a cold load
 * every operation replays in order and the done state is simply there.
 * Anything unrenderable falls back to the row's text.
 */
export function SurfaceMessage({ message }: { message: Message }) {
  const operations = surfaceOperations(message);
  // How many of the row's operations this processor has consumed.
  const processed = useRef(0);

  const processor = useMemo(() => {
    if (!operations) return null;
    const p = new MessageProcessor<ReactComponentImplementation>([agntchatCatalog(currentLocale())], undefined, {
      version: "v0.9.1",
    });
    try {
      p.processMessages(structuredClone(operations) as never);
    } catch (e) {
      console.warn("Surface rejected, showing plain text:", e);
      return null;
    }
    processed.current = operations.length;
    return p;
    // The surface is one processor per row: build only when the row changes;
    // later operations are fed as a tail below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  // The data model keeps (and mutates in place) the objects it is given, so
  // it gets copies: the store's rows stay immutable.
  const feed = (ops: SurfaceOperation[]) => {
    if (!processor || ops.length === 0) return;
    try {
      processor.processMessages(structuredClone(ops) as never);
    } catch (e) {
      console.warn("Surface update rejected:", e);
    }
  };
  const feedRef = useRef(feed);
  feedRef.current = feed;

  // The tail: operations the row gained since the processor last saw it.
  useEffect(() => {
    if (!processor || !operations || operations.length <= processed.current) return;
    const tail = operations.slice(processed.current);
    processed.current = operations.length;
    feedRef.current(tail);
  }, [processor, operations]);

  const host = useMemo<SurfaceHost>(
    () => ({
      messageId: message.id,
      conversationId: message.conversationId,
      applyOperations: (ops) => {
        // The store is the one writer: appending there re-renders this row
        // and the tail effect feeds the processor, and the later broadcast
        // of the same stamp dedupes against it. A row the store does not
        // hold (nothing to re-render) is fed directly.
        const stored = useChatStore.getState().appendSurfaceOperations(message.conversationId, message.id, ops);
        if (!stored) feedRef.current(ops);
      },
    }),
    [message.id, message.conversationId]
  );

  const [surfaces, setSurfaces] = useState<Surface[]>(() =>
    processor ? Array.from(processor.model.surfacesMap.values()) : []
  );
  useEffect(() => {
    if (!processor) {
      setSurfaces([]);
      return;
    }
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    sync();
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  if (!processor || surfaces.length === 0) {
    return message.content?.trim() ? <MarkdownContent content={message.content} /> : null;
  }

  return (
    <SurfaceContext.Provider value={host}>
      <div className="a2ui-surface">
        {surfaces.map((surface) => (
          <A2uiSurface key={surface.id} surface={surface} />
        ))}
      </div>
    </SurfaceContext.Provider>
  );
}
