import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../host";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { summarizeCard, templateIdOf } from "../rowSummary";
import {
  VisibleSchema,
  WeightSchema,
  bindingPathOf,
  childKey,
  renderChild,
  useDataValue,
  weightStyle,
  type ChildRef,
} from "../shared";
import { RowSummary } from "./RowSummary";

/** Bubble width below which a `grid` degrades to the carousel and the cards
 *  go full-bleed — keep equal to the `@container bubble (max-width: 479px)`
 *  rule in surface.css. */
const PHONE_MAX = 480;

export const ListApi = {
  name: "List",
  schema: z.object({
    children: CommonSchemas.ChildList,
    variant: z.enum(["cards", "rows", "grid"]).optional(),
    emptyText: CommonSchemas.DynamicString.optional(),
    maxVisible: z.number().int().min(1).max(10).optional(),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

/**
 * A collection of like items from a template binding. `cards` is a
 * horizontal snap carousel at every width (full-bleed cards with a peek on
 * phones, ~380px cards with a peek on panes — the same idiom mobile uses,
 * so results can be compared side by side instead of read as a stack);
 * `rows` is the compact row list — each row derived from the item's card
 * template (`rowSummary.ts`), expanding in place to the full card on tap,
 * one at a time, `Esc` to fold; `grid` goes two-up at 720px and degrades
 * to the carousel below 480px. Beyond `maxVisible` a localized "Show N
 * more" button reveals the rest.
 */
export const List = createComponentImplementation(ListApi, ({ props, buildChild, context }) => {
  const { t } = useTranslation("templates");
  const allRefs = (Array.isArray(props.children) ? props.children : []) as ChildRef[];
  const variant = props.variant ?? "cards";
  const maxVisible = props.maxVisible ?? 5;
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  // Rows: the one open row, and the rows opened this session (muted title).
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  // The node layer hands template instances synthesized ids (`item_card-[/items/0]`);
  // the component model is keyed by the authored id.
  const templateId = templateIdOf(allRefs.find((r): r is { id: string; basePath: string } => typeof r !== "string")?.id);
  const components = context.surfaceComponents;
  // An item whose card resolves hidden (its `visible` bound false — an item
  // an action consumed) is not an item any more: skipped outright, so the
  // carousel, its dots and "Show N more" count only what is there.
  // Subscribing to the list's data path re-renders when one goes.
  const listPath = bindingPathOf((context.componentModel.properties as { children?: unknown }).children);
  useDataValue(context.dataContext, listPath ?? "/");
  const templateVisible = templateId ? components.get(templateId)?.properties.visible : undefined;
  const refs =
    templateVisible === undefined
      ? allRefs
      : allRefs.filter(
          (ref) =>
            typeof ref === "string" ||
            context.dataContext.nested(ref.basePath).resolveDynamicValue(templateVisible as never) !== false
        );
  const summary = useMemo(
    () => (variant === "rows" && templateId ? summarizeCard(components, templateId) : null),
    [variant, templateId, components]
  );
  const scroller = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // The stylesheet degrades `grid` to the carousel below 480px (container
  // query on the bubble); the ARIA must follow the same measurement, so it
  // is taken here on the list root.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setPhone(el.getBoundingClientRect().width < PHONE_MAX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = expanded ? refs : refs.slice(0, maxVisible);
  const hidden = refs.length - visible.length;

  // Carousel position, from the scroller's own geometry.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    if (items.length === 0) return;
    const left = el.scrollLeft + el.clientWidth * 0.3;
    let index = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.offsetLeft - el.offsetLeft <= left) index = i;
    }
    setActive(index);
  }, []);

  useEffect(() => {
    if (active >= visible.length) setActive(0);
  }, [active, visible.length]);

  const scrollTo = (index: number) => {
    const el = scroller.current;
    const item = el?.children[index] as HTMLElement | undefined;
    if (el && item) el.scrollTo({ left: item.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };

  if (refs.length === 0) {
    const empty = typeof props.emptyText === "string" ? props.emptyText.trim() : "";
    if (!empty) return null;
    return (
      <div className="a2ui-card a2ui-card--compact" style={weightStyle(props.weight)}>
        <p className="a2ui-list__empty">{empty}</p>
      </div>
    );
  }

  const isCarousel = variant === "cards" || (variant === "grid" && phone);
  const items = (
    <ul
      ref={scroller}
      className="a2ui-list__items"
      role="list"
      aria-roledescription={isCarousel ? t("surface.carousel") : undefined}
      onScroll={isCarousel ? onScroll : undefined}
    >
      {visible.map((ref, i) => (
        <li key={childKey(ref, i)} role="listitem">
          {renderChild(ref, buildChild)}
        </li>
      ))}
    </ul>
  );
  const more = hidden > 0 && (
    <button type="button" className="a2ui-list__more" onClick={() => setExpanded(true)}>
      {t("surface.showMoreCount", { count: hidden })}
    </button>
  );

  if (variant === "rows") {
    const toggle = (key: string) => {
      setOpenRow((cur) => (cur === key ? null : key));
      setVisited((cur) => (cur.has(key) ? cur : new Set(cur).add(key)));
    };
    return (
      <div
        ref={root}
        className="a2ui-list a2ui-list--rows a2ui-rows"
        style={weightStyle(props.weight)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && openRow !== null) {
            e.stopPropagation();
            setOpenRow(null);
          }
        }}
      >
        <ul className="a2ui-list__items" role="list">
          {visible.map((ref, i) => {
            const key = childKey(ref, i);
            const open = openRow === key;
            // A static child (no template) has no summary to derive: render it whole.
            const summarised = summary !== null && typeof ref !== "string";
            return (
              <li key={key} role="listitem" className={open ? "a2ui-rows__item--open" : undefined}>
                {summarised ? (
                  <RowSummary
                    ids={summary}
                    components={components}
                    dataContext={context.dataContext}
                    basePath={ref.basePath}
                    expanded={open}
                    visited={visited.has(key)}
                    onToggle={() => toggle(key)}
                  />
                ) : (
                  renderChild(ref, buildChild)
                )}
                {summarised && open && <div className="a2ui-row__detail">{renderChild(ref, buildChild)}</div>}
              </li>
            );
          })}
        </ul>
        {more}
      </div>
    );
  }

  return (
    <div ref={root} className={`a2ui-list a2ui-list--${variant}`} style={weightStyle(props.weight)}>
      {items}
      {isCarousel && visible.length > 1 && (
        <div className="a2ui-carousel-nav">
          <button
            type="button"
            className="a2ui-carousel-nav__btn"
            aria-label={t("surface.previous")}
            disabled={active === 0}
            onClick={() => scrollTo(Math.max(0, active - 1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="a2ui-carousel-nav__btn"
            aria-label={t("surface.next")}
            disabled={active >= visible.length - 1}
            onClick={() => scrollTo(Math.min(visible.length - 1, active + 1))}
          >
            ›
          </button>
        </div>
      )}
      {isCarousel && visible.length > 1 && (
        <ul className="a2ui-dots" aria-hidden="true">
          {visible.map((ref, i) => (
            <li key={childKey(ref, i)}>
              <button
                type="button"
                tabIndex={-1}
                className={`a2ui-dot${i === active ? " a2ui-dot--active" : ""}`}
                onClick={() => scrollTo(i)}
              />
            </li>
          ))}
        </ul>
      )}
      {isCarousel && visible.length > 1 && (
        <span className="a2ui-sr" aria-live="polite">
          {t("surface.slideOf", { index: active + 1, count: visible.length })}
        </span>
      )}
      {more}
    </div>
  );
});
