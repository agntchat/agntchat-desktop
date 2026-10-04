import React, { createContext, useCallback, useContext, useRef, useSyncExternalStore } from "react";
import { z } from "zod";
import { CommonSchemas, type DataContext, type DataSubscription } from "@a2ui/web_core/v0_9";
import { currentLocale } from "./host";
import type { SurfaceOperation } from "./operations";

export { currentLocale };

// ---------------------------------------------------------------------------
// Host context — what SurfaceMessage hands every component of a surface.
// ---------------------------------------------------------------------------

/** What a surface's return leg posts against: a chat card lives on a
 *  message (`POST /api/messages/:id/actions`), a long-lived canvas on a
 *  surface row (`POST /api/surfaces/:id/actions`). Absent = nothing posts
 *  (a fixture, a preview without a compiled surface). */
export interface SurfaceTarget {
  kind: "message" | "surface";
  id: string;
}

export interface SurfaceHost {
  target?: SurfaceTarget;
  conversationId?: string;
  /** Feed operations the server just returned (`POST …/actions` → its
   *  `operation`) into this message's surface right away, so the presser
   *  sees the completion before the `surface_update` broadcast arrives. The
   *  broadcast then dedupes against it by data-model path. */
  applyOperations: (operations: SurfaceOperation[]) => void;
}

export const SurfaceContext = createContext<SurfaceHost>({
  applyOperations: () => {},
});

export function useSurfaceHost(): SurfaceHost {
  return useContext(SurfaceContext);
}

/** The `Card` mints a heading id; its `Header` puts it on the `<h3>` so the
 *  card is `aria-labelledby` its own title. */
export const CardLabelContext = createContext<string | undefined>(undefined);

// ---------------------------------------------------------------------------
// Slots — host-rendered regions inside a long-lived surface (a canvas).
// ---------------------------------------------------------------------------

export const SLOT_NAMES = ["message_list", "composer", "typing_indicator"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** What the host renders in each `Slot`. A name without a renderer draws the
 *  labelled placeholder (the studio preview, a client without that feature). */
export type SlotRenderers = Partial<Record<SlotName, () => React.ReactNode>>;

export const SlotContext = createContext<SlotRenderers>({});

export function useSlotRenderers(): SlotRenderers {
  return useContext(SlotContext);
}

// ---------------------------------------------------------------------------
// Schema fragments shared by the catalog components. Mirrors the enums in
// docs/feature-proposals/a2ui/chat-catalog.v1.json.
// ---------------------------------------------------------------------------

export const ToneSchema = z.enum(["neutral", "info", "success", "warning", "destructive"]);
export const SizeSchema = z.enum(["sm", "md", "lg"]);
export const GapSchema = z.enum(["none", "sm", "md", "lg"]);
export const WeightSchema = z.number().optional();
export const IconNameSchema = z.string();
export const LinkSchema = z.object({ url: CommonSchemas.DynamicString });
/** Every catalog component takes `visible`: bound and false → the renderer
 *  omits it (`withVisibility` in catalog/index.ts). Declared on every schema
 *  so the node layer resolves the binding; the server owns the values it
 *  binds to (`/_visible/<id>`), clients never evaluate conditions. */
export const VisibleSchema = CommonSchemas.DynamicBoolean.optional();
/** A prop that is a literal array/object OR a `{path}` to one. The binder
 *  treats the union as dynamic (resolves the path); a literal passes through
 *  raw, so components run `resolveDeep` over it for nested bindings. */
export function orBinding<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, CommonSchemas.DataBinding]);
}

export type Tone = z.infer<typeof ToneSchema>;
export type Size = z.infer<typeof SizeSchema>;

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/**
 * Resolve every nested `{path}` / `{call}` inside a literal object or array
 * against the component's data context. The generic binder resolves a
 * top-level binding; nested ones inside literal items (a ChipRow whose
 * items are `[{label: {path: "fields/x"}}]`) are left to the component.
 */
export function resolveDeep<T = unknown>(value: unknown, ctx: DataContext): T {
  if (value === null || typeof value !== "object") return value as T;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx)) as T;
  const obj = value as Record<string, unknown>;
  if (typeof obj.path === "string" || typeof obj.call === "string") {
    return ctx.resolveDynamicValue(obj as never) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = resolveDeep(v, ctx);
  return out as T;
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "geo:"]);

/** Only http(s), mailto:, tel: and geo: leave the card. Anything else
 *  (javascript:, data:, relative) is dropped. */
export function safeUrl(value: unknown): string | null {
  const raw = asString(value)?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function isExternalUrl(url: string): boolean {
  return url.startsWith("http:") || url.startsWith("https:");
}

const ITEM_SCOPE = /(?:^|\/)items\/(\d+)\/?$/;

/**
 * The result item a component belongs to. Inside a `List` template the data
 * scope is `/items/<n>` and every item shares the component ids, so the
 * scope is the only signal. Per-item cards (differing shapes) bind absolute
 * paths from the root scope and the compiler suffixes their ids `_<n>`
 * instead. A single-item card is item 0. Keys the completion stamp at
 * `/items/<n>/actions/<action.id>`.
 */
export function itemIndexOf(dataPath: string | undefined, componentId?: string): number {
  const scoped = ITEM_SCOPE.exec(dataPath ?? "");
  if (scoped) return Number(scoped[1]);
  const suffixed = /_(\d+)$/.exec(componentId ?? "");
  return suffixed ? Number(suffixed[1]) : 0;
}

/**
 * The data-model path of a component's action stamps: RELATIVE
 * (`actions`) when the component sits in an item scope — the data context
 * resolves it per item, exactly as the binder resolves `{path: "title"}` —
 * and absolute `/items/<n>/actions` from the root scope of a chat card. A
 * canvas surface has no items: its stamps live at `/_actions/<action_id>`.
 */
export function actionStampsPath(
  dataPath: string | undefined,
  itemIndex: number,
  targetKind: SurfaceTarget["kind"] = "message"
): string {
  if (ITEM_SCOPE.test(dataPath ?? "")) return "actions";
  return targetKind === "surface" ? "/_actions" : `/items/${itemIndex}/actions`;
}

/** A binding path made absolute against the component's data scope, so a
 *  write can be posted to the server as a JSON Pointer into the model. */
export function absoluteDataPath(dataPath: string | undefined, path: string): string {
  if (path.startsWith("/")) return path;
  const base = (dataPath ?? "/").replace(/\/+$/, "");
  return `${base}/${path}`;
}

/** The raw `{path}` of a component property as authored (before the binder
 *  resolved it), or undefined for a literal. */
export function bindingPathOf(raw: unknown): string | undefined {
  const rec = asRecord(raw);
  return rec && typeof rec.path === "string" ? rec.path : undefined;
}

/**
 * A DynamicBoolean as authored — a literal, or a `{path}` kept live through
 * the data context. Unconditional hooks: a literal subscribes to nothing.
 */
export function useDynamicBoolean(ctx: DataContext, raw: unknown): boolean | undefined {
  const path = bindingPathOf(raw);
  const subRef = useRef<DataSubscription<unknown> | null>(null);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (path === undefined) return () => {};
      const sub = ctx.subscribeDynamicValue<unknown>({ path }, () => notify());
      subRef.current = sub;
      return () => {
        sub.unsubscribe();
        if (subRef.current === sub) subRef.current = null;
      };
    },
    [ctx, path]
  );
  const getSnapshot = useCallback(() => {
    if (path === undefined) return raw;
    return subRef.current ? subRef.current.value : ctx.resolveDynamicValue<unknown>({ path });
  }, [ctx, path, raw]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  return typeof value === "boolean" ? value : undefined;
}

/**
 * A value bound to a data-model path, resolved through the component's
 * data context (relative paths against its scope) and kept live: the hook
 * re-renders when an `updateDataModel` lands on the path, any ancestor or
 * any descendant — the same signal subscription the generic binder uses.
 */
export function useDataValue<T>(ctx: DataContext, path: string): T | undefined {
  const subRef = useRef<DataSubscription<T> | null>(null);
  const subscribe = useCallback(
    (notify: () => void) => {
      const sub = ctx.subscribeDynamicValue<T>({ path }, () => notify());
      subRef.current = sub;
      return () => {
        sub.unsubscribe();
        if (subRef.current === sub) subRef.current = null;
      };
    },
    [ctx, path]
  );
  const getSnapshot = useCallback(
    () => (subRef.current ? subRef.current.value : ctx.resolveDynamicValue<T>({ path })),
    [ctx, path]
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function weightStyle(weight: unknown): React.CSSProperties {
  return typeof weight === "number" ? { flex: `${weight}`, minWidth: 0, minHeight: 0 } : {};
}

export function formatNumberValue(
  value: number,
  format: "number" | "percent" | "currency" | "compact" | undefined,
  currency?: string
): string {
  const locale = currentLocale();
  try {
    switch (format) {
      case "percent":
        return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
          value / 100
        );
      case "currency":
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: currency || "USD",
          maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
        }).format(value);
      case "compact":
        return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
          value
        );
      default:
        return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
    }
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Child rendering
// ---------------------------------------------------------------------------

/** What the node layer hands a component for a `ChildList`: a component id
 *  at the parent's data scope, or an `{id, basePath}` pair for a template item. */
export type ChildRef = string | { id: string; basePath: string };

export type BuildChild = (id: string, basePath?: string) => React.ReactNode;

export function renderChild(ref: ChildRef | undefined, buildChild: BuildChild): React.ReactNode {
  if (!ref) return null;
  if (typeof ref === "string") return buildChild(ref);
  return buildChild(ref.id, ref.basePath);
}

export function childKey(ref: ChildRef, index: number): string {
  return typeof ref === "string" ? `${ref}-${index}` : `${ref.id}-${ref.basePath}`;
}

export const Children: React.FC<{ refs: unknown; buildChild: BuildChild }> = ({ refs, buildChild }) => {
  if (!Array.isArray(refs)) return null;
  return (
    <>
      {(refs as ChildRef[]).map((ref, i) => (
        <React.Fragment key={childKey(ref, i)}>{renderChild(ref, buildChild)}</React.Fragment>
      ))}
    </>
  );
};
