import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCanvasStore } from "../../stores/canvasStore";
import type { SurfaceOperation } from "../../a2ui/operations";
import { SurfaceView, useSurfaceProcessor } from "../../a2ui/render";
import type { SurfaceHost } from "../../a2ui/shared";
import "../../a2ui/surface.css";

/** Typing pauses this long before the definition is compiled server-side. */
const PREVIEW_DEBOUNCE_MS = 500;

/** The catalog's controls that would post or navigate. Tabs, inputs and
 *  toggles stay live (they only touch the preview's local data model);
 *  actions and links are neutralized at the capture phase so a press in the
 *  studio never reaches the server or leaves the app. */
const INERT_SELECTOR = ".a2ui-btn, .a2ui-menu__item, .a2ui-toggle__switch, a";

function swallowActionClick(e: React.MouseEvent) {
  const target = e.target as Element | null;
  if (!target?.closest?.(INERT_SELECTOR)) return;
  e.preventDefault();
  e.stopPropagation();
}

/** The `surfaceId` of the compiled preview's `createSurface`, so its host
 *  target matches what the components see. */
function previewSurfaceId(operations: SurfaceOperation[]): string {
  for (const op of operations) {
    const create = op.createSurface;
    if (create && typeof create === "object") {
      const id = (create as { surfaceId?: unknown }).surfaceId;
      if (typeof id === "string" && id) return id;
    }
  }
  return "preview";
}

interface Props {
  /** The editor's raw JSON — parsed and debounced here. */
  json: string;
  /** Compiler validation errors for the current definition (null once it
   *  compiles), for the editor's errors area. */
  onErrors?: (errors: string[] | null) => void;
}

/**
 * The studio's live preview: the real compiled surface (a hand-kept twin of
 * web/src/components/canvas/CanvasSurfacePreview.tsx — the logic lives in
 * the synced `src/a2ui/` renderer, this only wires it to the editor). The definition is
 * posted to `POST /api/canvas-definitions/preview` and the returned
 * operations render through the shared A2UI renderer — the same catalog and
 * processor every client uses — with `Slot`s drawn as their labelled
 * placeholders and the zone Columns in order. A 400 `{errors}` from the
 * compiler goes to `onErrors`; the last good surface stays on screen.
 */
export function CanvasSurfacePreview({ json, onErrors }: Props) {
  const { t } = useTranslation("canvas");
  const previewDefinition = useCanvasStore((s) => s.previewDefinition);

  const definition = useMemo(() => {
    try {
      const parsed = JSON.parse(json);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }, [json]);

  const [operations, setOperations] = useState<SurfaceOperation[] | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const onErrorsRef = useRef(onErrors);
  onErrorsRef.current = onErrors;

  useEffect(() => {
    if (!definition) return;
    const seq = ++request.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await previewDefinition(definition);
        if (seq !== request.current) return;
        setFailed(false);
        if (result.errors.length > 0) {
          onErrorsRef.current?.(result.errors);
        } else {
          onErrorsRef.current?.(null);
          setOperations(result.operations);
          setVersion((v) => v + 1);
        }
      } catch (e) {
        if (seq !== request.current) return;
        console.warn("Canvas preview failed:", e);
        setFailed(true);
      } finally {
        if (seq === request.current) setLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [definition, previewDefinition]);

  const { surfaces, feed } = useSurfaceProcessor(operations, String(version));
  const surfaceId = useMemo(() => previewSurfaceId(operations ?? []), [operations]);
  const host = useMemo<SurfaceHost>(
    () => ({ target: { kind: "surface", id: surfaceId }, applyOperations: feed }),
    // `feed` is a stable forwarder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surfaceId]
  );

  if (!definition && operations === null) {
    return (
      <PreviewState icon={<AlertCircle className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />} text={t("surfacePreview.fixJson")} />
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-auto scrollbar-subtle">
      {loading && (
        <div className="pointer-events-none absolute right-3 top-2 z-10 flex items-center gap-1.5 rounded-full bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("surfacePreview.compiling")}
        </div>
      )}
      {failed && (
        <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{t("surfacePreview.failed")}</p>
        </div>
      )}
      {surfaces.length > 0 ? (
        <div className="p-3" onClickCapture={swallowActionClick}>
          <SurfaceView host={host} surfaces={surfaces} />
        </div>
      ) : operations !== null ? (
        <PreviewState text={t("surfacePreview.empty")} />
      ) : !loading ? (
        <PreviewState text={t("surfacePreview.waiting")} />
      ) : null}
    </div>
  );
}

function PreviewState({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div>
        {icon}
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
