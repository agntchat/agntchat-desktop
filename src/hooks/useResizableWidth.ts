import { useCallback, useEffect, useRef, useState } from "react";

/** Upper bound for a pane width: a fixed px value, or a function of the
 *  viewport width for panes whose ceiling should grow with the window. */
export type MaxWidth = number | ((viewportWidth: number) => number);

function resolveMax(max: MaxWidth): number {
  if (typeof max !== "function") return max;
  return max(typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth);
}

/**
 * Drag-to-resize for a left list pane. Returns the current width, a ref to put
 * on the resizable element (its left edge is the measurement origin), and the
 * handlers a {@link ResizeHandle} consumes.
 *
 * Each call persists to its own localStorage key, so different views (chat,
 * tasks, templates, canvas) remember their list widths independently. Width is
 * clamped to [min, max]; double-click on the handle snaps back to `defaultWidth`.
 */
export interface ResizableWidth {
  /** Current pane width in px. Apply via `style={{ width }}`. */
  width: number;
  /** Put on the resizable element — its left edge is the drag origin. */
  ref: React.RefObject<HTMLElement | null>;
  /** True while a drag is in flight (for grip styling). */
  resizing: boolean;
  /** `onPointerDown` for the handle. */
  onResizeStart: (e: React.PointerEvent) => void;
  /** `onDoubleClick` for the handle — resets to the default width. */
  onResizeReset: () => void;
}

export function useResizableWidth({
  storageKey,
  defaultWidth,
  min,
  max,
  side = "left",
}: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  /** Fixed px, or `(viewportWidth) => px` — re-evaluated on window resize, with
   *  the current width re-clamped so a pane never outgrows a shrunk window. */
  max: MaxWidth;
  /** Which edge the pane is docked to. `"left"` (default) grows rightward
   *  from the pane's left edge (list panes); `"right"` grows leftward from the
   *  pane's right edge (right-docked panes like the huddle side pane), so
   *  dragging the left handle outward widens it. */
  side?: "left" | "right";
}): ResizableWidth {
  const [maxPx, setMaxPx] = useState<number>(() => resolveMax(max));
  const clamp = useCallback(
    (px: number) => Math.max(min, Math.min(maxPx, px)),
    [min, maxPx]
  );

  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) return Math.max(min, Math.min(resolveMax(max), n));
      }
    } catch {}
    return defaultWidth;
  });

  // A viewport-relative ceiling follows the window: recompute on resize and
  // pull the current width back under it.
  useEffect(() => {
    setMaxPx(resolveMax(max));
    if (typeof max !== "function") return;
    const onResize = () => setMaxPx(resolveMax(max));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [max]);

  useEffect(() => {
    setWidth((w) => clamp(w));
  }, [clamp]);

  const [resizing, setResizing] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Track the pointer globally while a drag is in flight so the handle keeps
  // following even if the cursor outruns the thin grip. Width is the pointer's
  // X relative to the pane's left edge. While resizing we set a body cursor +
  // disable text selection for a clean drag feel.
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const right = rect?.right ?? 0;

      const onMove = (ev: PointerEvent) => {
        // Left-docked: width = pointer distance from the left edge. Right-docked:
        // width = distance from the right edge (pointer moving left widens it).
        setWidth(clamp(side === "right" ? right - ev.clientX : ev.clientX - left));
      };
      const onUp = () => {
        setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clamp, side]
  );

  const onResizeReset = useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {}
  }, [storageKey, width]);

  return { width, ref, resizing, onResizeStart, onResizeReset };
}

/**
 * Shared width for the right-docked panes (the huddle side pane and the
 * conversation-details pane). Both call this with the SAME storage key, so a
 * width dragged on one applies to the other — switching between a huddle and
 * details never jolts. Only one pane is mounted at a time, so they don't
 * fight over the ref.
 */
export function useRightPaneWidth(): ResizableWidth {
  return useResizableWidth({
    storageKey: "agentchat:rightPaneWidth",
    defaultWidth: 416,
    min: 320,
    max: 640,
    side: "right",
  });
}

/** Room the artifact pane always leaves for the rail + list + chat column. */
const ARTIFACT_PANE_RESERVED = 560;
/** The artifact pane may always reach at least this wide, however small the
 *  window — below that the ceiling would barely beat the docked default. */
const ARTIFACT_PANE_MAX_FLOOR = 640;
const artifactPaneMax = (viewportWidth: number) =>
  Math.max(ARTIFACT_PANE_MAX_FLOOR, viewportWidth - ARTIFACT_PANE_RESERVED);

/**
 * Width for the right-docked artifact viewer. Its own storage key (a reading
 * pane wants to be wider than the details / huddle panes, and dragging it out
 * shouldn't drag those along), and a ceiling that grows with the window so a
 * wide display can give most of itself to the document while the chat column
 * keeps a usable minimum.
 */
export function useArtifactPaneWidth(): ResizableWidth {
  return useResizableWidth({
    storageKey: "agentchat:artifactPaneWidth",
    defaultWidth: 480,
    min: 320,
    max: artifactPaneMax,
    side: "right",
  });
}
