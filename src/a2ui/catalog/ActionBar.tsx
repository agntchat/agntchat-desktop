import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createBinderlessComponentImplementation } from "@a2ui/react/v0_9";
import { CheckCircle, ExternalLink, MoreHorizontal } from "lucide-react";
import { openExternal, resolveIcon, saveContactFile, useTranslation } from "../host";
import { OPEN_RESULTS, PENDING_TTL_MS, postSurfaceAction, type SurfaceActionBody, type SurfaceActionStamp } from "../actions";
import { buildVCard, vcardFilename } from "../vcard";
import {
  IconNameSchema,
  VisibleSchema, WeightSchema,
  actionStampsPath,
  asRecord,
  asString,
  itemIndexOf,
  resolveDeep,
  safeUrl,
  useDataValue,
  useSurfaceHost,
  weightStyle,
} from "../shared";

const KindSchema = z.enum(["primary", "secondary", "destructive", "link"]);

const ActionItemSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: CommonSchemas.DynamicString,
  kind: KindSchema.optional(),
  icon: IconNameSchema.optional(),
  confirm: CommonSchemas.DynamicString.optional(),
  action: CommonSchemas.Action,
  /** Completing it closes the item: every other action goes unavailable
   *  (and the server refuses them) — a sent or deleted draft. */
  final: z.boolean().optional(),
  /** A data-model write the SERVER applies to the surface after the action
   *  succeeds (switch the active tab). Accepted here, never run here. */
  then: z.object({ path: z.string(), value: z.unknown() }).optional(),
});

export const ActionBarApi = {
  name: "ActionBar",
  schema: z.object({
    actions: z.array(ActionItemSchema).min(1).max(5),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

type Kind = z.infer<typeof KindSchema>;

interface ResolvedAction {
  id: string;
  label: string;
  kind: Kind;
  Icon: ReturnType<typeof resolveIcon>;
  confirm?: string;
  final: boolean;
  /** Resolved http(s)/mailto/tel URL when the action is `openUrl`. */
  url: string | null;
  fn?: string;
  args: Record<string, unknown>;
  event?: { name: string; context: Record<string, unknown> };
}

interface DoneState {
  short: string;
  caption?: string;
}

interface ActionState {
  busy?: boolean;
  /** Transient "Copied" — never latches. */
  flash?: string;
  confirming?: boolean;
  notice?: { tone: "warning" | "destructive"; text: string };
}

/**
 * All of a card's actions in one place, with policy: at most one primary,
 * up to two visible secondaries, the rest behind a localized "More" menu.
 * Binderless so the raw `Action` (function name, args, ids) stays visible —
 * the generic binder would collapse it to an opaque closure.
 *
 * The one rule every client implements: a `functionCall` this client runs
 * itself (`openUrl`, `copyText`) runs here and never posts; every other
 * `functionCall` (`sendEmail`, `saveDraft`, the device functions) is posted
 * as an `invoke` with the args resolved from the data model, and the server
 * runs backend tools as the presser or relays the rest to the agent; an
 * `event` is posted by name — to the message or the surface the host names
 * as its target. Done state is the stamp the server writes into the data
 * model at `actions/<id>` under the item (`/_actions/<id>` on a canvas) —
 * read live through the data context, so the presser, every other client
 * and a cold load agree.
 * The client never re-implements Gmail for surfaces.
 */
export const ActionBar = createBinderlessComponentImplementation(ActionBarApi, ({ context }) => {
  const { t } = useTranslation("templates");
  const { t: tChat } = useTranslation("chat");
  const host = useSurfaceHost();
  const [states, setStates] = useState<Record<string, ActionState>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const patch = useCallback((id: string, next: ActionState) => {
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const dataContext = context.dataContext;
  const itemIndex = itemIndexOf(dataContext.path, context.componentModel.id);
  const stamps = useDataValue<Record<string, SurfaceActionStamp>>(
    dataContext,
    actionStampsPath(dataContext.path, itemIndex, host.target?.kind)
  );
  const raw = context.componentModel.properties as { actions?: unknown[]; weight?: unknown };
  const actions: ResolvedAction[] = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((entry): ResolvedAction | null => {
      const item = asRecord(entry);
      const id = item ? asString(item.id) : undefined;
      if (!item || !id) return null;
      const action = asRecord(item.action) ?? {};
      const fnCall = asRecord(action.functionCall);
      const event = asRecord(action.event);
      const fn = fnCall ? asString(fnCall.call) : undefined;
      const args = fnCall ? (asRecord(resolveDeep(fnCall.args ?? {}, dataContext)) ?? {}) : {};
      const kind = KindSchema.safeParse(item.kind).success ? (item.kind as Kind) : "secondary";
      return {
        id,
        label: asString(dataContext.resolveDynamicValue(item.label as never)) ?? "",
        kind,
        Icon: resolveIcon(asString(item.icon)),
        confirm: item.confirm !== undefined ? asString(dataContext.resolveDynamicValue(item.confirm as never)) : undefined,
        final: item.final === true,
        url: fn === "openUrl" ? safeUrl(args.url) : null,
        fn,
        args,
        event: event && typeof event.name === "string"
          ? { name: event.name, context: asRecord(resolveDeep(event.context ?? {}, dataContext)) ?? {} }
          : undefined,
      };
    })
    .filter((a): a is ResolvedAction => a !== null);

  /** The action's stamp: its state, written by the server into the data
   *  model and read live, so the presser, every other client and a cold
   *  load agree. */
  const stampOf = (action: ResolvedAction): SurfaceActionStamp | undefined =>
    asRecord(stamps?.[action.id]) as SurfaceActionStamp | undefined;

  /** Running on some device: a fresh `pending` stamp. */
  const runningElsewhere = (action: ResolvedAction): boolean => {
    const stamp = stampOf(action);
    if (stamp?.result !== "pending") return false;
    const started = stamp.started_at ? Date.parse(stamp.started_at) : NaN;
    return Number.isFinite(started) && Date.now() - started < PENDING_TTL_MS;
  };

  /** The failure the last run stamped — shown on every device. */
  const recordedError = (action: ResolvedAction): string | undefined => {
    const stamp = stampOf(action);
    return stamp?.result === "error" ? asString(stamp.error)?.trim() || tChat("results.actionFailed") : undefined;
  };

  /** Done: the label is the outcome the function's tool declares
   *  (`surface.done.<outcome>`), the caption its declared line — no
   *  function is named here. Anything without an outcome keeps its own
   *  label under the check mark: "✓ Watch" says what happened. */
  const recordedDone = (action: ResolvedAction): DoneState | undefined => {
    const stamp = stampOf(action);
    const result = asString(stamp?.result);
    if (!stamp || !result || OPEN_RESULTS.has(result)) return undefined;
    const outcome = asString(stamp.outcome) ?? (["ok", "relayed", "executed"].includes(result) ? undefined : result);
    const short = outcome ? t(`surface.done.${outcome}`, { defaultValue: action.label }) : action.label;
    const captionKey = asString(stamp.caption);
    const caption = captionKey ? t(`surface.${captionKey}`, { ...stringArgs(action.args), defaultValue: "" }) : "";
    return { short, caption: caption || undefined };
  };

  /** A done `final` action (Send, Delete draft) closes the item: the other
   *  actions stay visible but can no longer run. */
  const closed = actions.some(
    (a) => a.final && (recordedDone(a) !== undefined || runningElsewhere(a) || states[a.id]?.busy === true)
  );
  const unavailable = (action: ResolvedAction) =>
    closed && !recordedDone(action) && !runningElsewhere(action) && states[action.id]?.busy !== true;

  const run = async (action: ResolvedAction) => {
    const state = states[action.id] ?? {};
    if (state.busy || runningElsewhere(action) || recordedDone(action) || unavailable(action)) return;
    setMenuOpen(false);

    if (action.kind === "destructive" && action.confirm && !state.confirming) {
      patch(action.id, { confirming: true });
      later(() => patch(action.id, { confirming: false }), 5000);
      return;
    }
    patch(action.id, { confirming: false, notice: undefined });

    // Copy never latches: it flashes and resets so the string can be taken twice.
    if (action.fn === "copyText") {
      const text = asString(action.args.text)?.trim();
      if (!text) {
        patch(action.id, { notice: { tone: "warning", text: tChat("results.nothingToCopy") } });
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        patch(action.id, { flash: t("surface.done.copied") });
      } catch {
        patch(action.id, { notice: { tone: "destructive", text: tChat("results.actionFailed") } });
      }
      later(() => patch(action.id, { flash: undefined }), 2000);
      return;
    }

    if (action.fn === "openUrl") {
      if (!action.url) {
        patch(action.id, { notice: { tone: "destructive", text: tChat("results.actionFailed") } });
        return;
      }
      openExternal(action.url);
      return;
    }

    // The device takes the contact (a vCard here, the native form on
    // mobile); the stamp then records `executed` so every client shows the
    // same done state.
    if (action.fn === "saveContact") {
      const name = asString(action.args.name)?.trim();
      if (!name) {
        patch(action.id, { notice: { tone: "destructive", text: tChat("results.actionFailed") } });
        return;
      }
      patch(action.id, { busy: true });
      try {
        await saveContactFile(vcardFilename(name), buildVCard(action.args));
        if (host.target) {
          const res = await postSurfaceAction(host.target, {
            action_id: action.id,
            item_index: itemIndex,
            executed: { function: "saveContact", result: "saved" },
          });
          if (res.operation) host.applyOperations([res.operation]);
        }
        patch(action.id, { busy: false });
      } catch (e) {
        console.error("A2UI saveContact failed:", e);
        patch(action.id, { busy: false, notice: { tone: "destructive", text: tChat("results.actionFailed") } });
      }
      return;
    }

    // The return leg: an `event` by name, or an `invoke` for every function
    // this client does not run itself (`sendEmail`, `saveDraft`, and the
    // device functions — notifications, location, avatar picker,
    // create-agent screen). The server runs backend tools as the presser
    // (Gmail with the presser's credential, `draft_id` honoured) and relays
    // the rest to the agent as a UserAction; either way it stamps the item.
    let body: SurfaceActionBody;
    if (action.event) {
      body = {
        action_id: action.id,
        item_index: itemIndex,
        name: action.event.name,
        label: action.label,
        context: action.event.context,
      };
    } else if (action.fn) {
      body = { action_id: action.id, item_index: itemIndex, invoke: { function: action.fn, args: action.args } };
    } else {
      patch(action.id, { notice: { tone: "destructive", text: tChat("results.actionFailed") } });
      return;
    }

    patch(action.id, { busy: true });
    try {
      if (!host.target) throw new Error("No target for surface action");
      const res = await postSurfaceAction(host.target, body);
      // The stamp lands on this surface at once; the server's
      // `surface_update` for the same path is then a no-op.
      if (res.operation) host.applyOperations([res.operation]);
      // A failure is stamped too (`error`), so every device shows why and
      // the button stays pressable; nothing more to do here.
      patch(action.id, { busy: false });
    } catch (e) {
      // 409: already running on another device, or the item is closed — the
      // stamps say which, and they are already on their way.
      if ((e as { status?: number }).status === 409) {
        patch(action.id, { busy: false });
        return;
      }
      console.error("A2UI action failed:", e);
      patch(action.id, { busy: false, notice: { tone: "destructive", text: tChat("results.actionFailed") } });
    }
  };

  if (actions.length === 0) return null;

  const primary = actions.find((a) => a.kind === "primary");
  const others = actions.filter((a) => a !== primary);
  const visible = [...(primary ? [primary] : []), ...others.slice(0, 2)];
  const overflow = others.slice(2);

  const renderButton = (action: ResolvedAction) => {
    const state = states[action.id] ?? {};
    const done = recordedDone(action);
    const busy = state.busy === true || runningElsewhere(action);
    const kindClass = action.kind === "link" ? "link" : action.kind === "destructive" ? "destructive" : action.kind;
    const cls = ["a2ui-btn", `a2ui-btn--${kindClass}`, done || state.flash ? "a2ui-btn--done" : "", state.confirming ? "a2ui-btn--confirm" : ""]
      .filter(Boolean)
      .join(" ");

    if (action.url && !busy) {
      // A link action opens a tab and never latches; an anchor keeps the
      // browser's own new-tab / copy-link affordances.
      return (
        <a key={action.id} className={cls} href={action.url} target="_blank" rel="noopener noreferrer">
          {action.Icon && <action.Icon className="a2ui-i" aria-hidden="true" />}
          <span>{action.label}</span>
          {action.kind === "primary" && <ExternalLink className="a2ui-i" aria-hidden="true" />}
        </a>
      );
    }

    const label = state.flash ?? done?.short ?? (state.confirming ? action.confirm : undefined) ?? action.label;
    return (
      <button
        key={action.id}
        type="button"
        className={cls}
        aria-busy={busy || undefined}
        aria-disabled={done ? true : undefined}
        disabled={busy || unavailable(action)}
        title={done?.caption}
        onClick={() => void run(action)}
      >
        {busy ? (
          <span className="a2ui-spinner" aria-hidden="true" />
        ) : done || state.flash ? (
          <CheckCircle className="a2ui-i" aria-hidden="true" />
        ) : action.Icon ? (
          <action.Icon className="a2ui-i" aria-hidden="true" />
        ) : null}
        <span>{label}</span>
      </button>
    );
  };

  const notices = actions
    .map((a) => {
      const local = states[a.id]?.notice;
      if (local) return local;
      const error = recordedError(a);
      return error ? { tone: "warning" as const, text: error } : undefined;
    })
    .filter((n): n is NonNullable<typeof n> => !!n);
  const captions = actions
    .map((a) => recordedDone(a)?.caption)
    .filter((c): c is string => !!c);

  return (
    <div className="a2ui-actions-wrap" style={weightStyle(raw.weight)}>
      {notices.map((n, i) => (
        <div key={i} className={`a2ui-notice a2ui-notice--${n.tone}`} role="status">
          {n.text}
        </div>
      ))}
      <div className="a2ui-actions">
        {visible.map(renderButton)}
        {overflow.length > 0 && (
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="a2ui-btn a2ui-btn--more"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("surface.moreActions")}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreHorizontal className="a2ui-i" aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="a2ui-menu" role="menu">
                {overflow.map((action) => {
                  const done = recordedDone(action);
                  const item = (
                    <>
                      {done ? <CheckCircle className="a2ui-i" aria-hidden="true" /> : action.Icon ? <action.Icon className="a2ui-i" aria-hidden="true" /> : null}
                      <span>{done ? done.short : action.label}</span>
                    </>
                  );
                  if (action.url) {
                    return (
                      <a key={action.id} role="menuitem" className="a2ui-menu__item" href={action.url} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>
                        {item}
                      </a>
                    );
                  }
                  return (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      className={`a2ui-menu__item${action.kind === "destructive" ? " a2ui-menu__item--destructive" : ""}`}
                      aria-disabled={done || unavailable(action) ? true : undefined}
                      disabled={unavailable(action)}
                      onClick={() => void run(action)}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {captions.map((c, i) => (
          <div key={i} className="a2ui-actions__caption">
            {c}
          </div>
        ))}
      </div>
    </div>
  );
});

/** An action's args as i18n interpolation values: scalars only. */
function stringArgs(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  return out;
}
