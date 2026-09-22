import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { MarkdownContent, useTranslation } from "../host";
import { VisibleSchema, WeightSchema, asString, weightStyle } from "../shared";

export const TextApi = {
  name: "Text",
  schema: z.object({
    text: CommonSchemas.DynamicString,
    variant: z.enum(["body", "caption", "label"]).optional(),
    maxLines: z.number().int().min(1).max(12).optional(),
    mono: z.boolean().optional(),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

/** Prose. `body` renders the markdown subset through MarkdownContent;
 *  `caption`/`label` are short plain lines. `maxLines` clamps with a
 *  localized Show more / Show less — the one collapse rule for every client. */
export const Text = createComponentImplementation(TextApi, ({ props }) => {
  const { t } = useTranslation("templates");
  const text = asString(props.text) ?? "";
  const variant = props.variant ?? "body";
  const maxLines = props.maxLines;
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clampRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = clampRef.current;
    if (!el || !maxLines || expanded) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, maxLines, expanded]);

  useEffect(() => {
    if (!maxLines || expanded) return;
    const el = clampRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setOverflows(el.scrollHeight > el.clientHeight + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxLines, expanded]);

  const body =
    variant === "body" ? (
      <MarkdownContent content={text} />
    ) : (
      <span>{text}</span>
    );

  const cls = `a2ui-text a2ui-text--${variant}${props.mono ? " a2ui-text--mono" : ""}`;
  if (!maxLines) {
    return (
      <div className={cls} style={weightStyle(props.weight)}>
        {body}
      </div>
    );
  }
  return (
    <div className={cls} style={weightStyle(props.weight)}>
      <div
        ref={clampRef}
        className={expanded ? undefined : "a2ui-text__clamp"}
        style={expanded ? undefined : { WebkitLineClamp: maxLines }}
      >
        {body}
      </div>
      {(overflows || expanded) && (
        <button type="button" className="a2ui-show-more" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          {expanded ? t("surface.showLess") : t("surface.showMore")}
        </button>
      )}
    </div>
  );
});
