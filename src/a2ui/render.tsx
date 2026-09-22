import { useEffect, useMemo, useRef, useState } from "react";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { A2uiSurface, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { agntchatCatalog } from "./catalog";
import { currentLocale } from "./host";
import type { SurfaceOperation } from "./operations";
import { SurfaceContext, type SurfaceHost } from "./shared";

export type Surface = SurfaceModel<ReactComponentImplementation>;

/**
 * One MessageProcessor per surface source (a message row, a canvas, a studio
 * preview), built once per `resetKey` and never rebuilt: operations the
 * source gains later (`surface_update`, the presser's optimistic copy) are
 * fed to the existing processor as a tail, so bound components update in
 * place — no flash. On a cold load every operation replays in order.
 * `surfaces` is what to hand `SurfaceView`; empty when the operations were
 * rejected (the caller falls back — a message shows its text).
 */
export function useSurfaceProcessor(operations: SurfaceOperation[] | null, resetKey: string) {
  // How many of the source's operations this processor has consumed.
  const processed = useRef(0);

  const processor = useMemo(() => {
    if (!operations) return null;
    const p = new MessageProcessor<ReactComponentImplementation>([agntchatCatalog(currentLocale())], undefined, {
      version: "v0.9.1",
    });
    try {
      // The data model keeps (and mutates in place) the objects it is given,
      // so it gets copies: the caller's rows stay immutable.
      p.processMessages(structuredClone(operations) as never);
    } catch (e) {
      console.warn("Surface rejected:", e);
      return null;
    }
    processed.current = operations.length;
    return p;
    // Build only when the source changes; later operations are a tail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

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

  // The tail: operations the source gained since the processor last saw it.
  useEffect(() => {
    if (!processor || !operations || operations.length <= processed.current) return;
    const tail = operations.slice(processed.current);
    processed.current = operations.length;
    feedRef.current(tail);
  }, [processor, operations]);

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

  return { processor, surfaces, feed: (ops: SurfaceOperation[]) => feedRef.current(ops) };
}

/** The surfaces of one processor rendered with the agntchat catalog under
 *  the host that owns them (its action target, slot renderers come from an
 *  outer `SlotContext`). */
export function SurfaceView({ host, surfaces, className }: { host: SurfaceHost; surfaces: Surface[]; className?: string }) {
  return (
    <SurfaceContext.Provider value={host}>
      <div className={className ? `a2ui-surface ${className}` : "a2ui-surface"}>
        {surfaces.map((surface) => (
          <A2uiSurface key={surface.id} surface={surface} />
        ))}
      </div>
    </SurfaceContext.Provider>
  );
}
