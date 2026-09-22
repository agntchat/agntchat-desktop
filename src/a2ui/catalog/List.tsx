import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../host";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { VisibleSchema, WeightSchema, childKey, renderChild, weightStyle, type ChildRef } from "../shared";

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
 * `rows` is the compact 72px row list; `grid` goes two-up at 720px and
 * degrades to the carousel below 480px. Beyond `maxVisible` a localized
 * "Show N more" button reveals the rest.
 */
export const List = createComponentImplementation(ListApi, ({ props, buildChild }) => {
  const { t } = useTranslation("templates");
  const refs = (Array.isArray(props.children) ? props.children : []) as ChildRef[];
  const variant = props.variant ?? "cards";
  const maxVisible = props.maxVisible ?? 5;
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
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
    return (
      <div ref={root} className="a2ui-list a2ui-list--rows a2ui-rows" style={weightStyle(props.weight)}>
        {items}
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
