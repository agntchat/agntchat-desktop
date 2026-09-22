import { useTranslation } from "../host";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { WeightSchema, asArray, asNumber, asRecord, asString, orBinding, resolveDeep, safeUrl, weightStyle } from "../shared";

const CitationSchema = z.object({
  name: CommonSchemas.DynamicString,
  url: CommonSchemas.DynamicString.optional(),
  confidence: CommonSchemas.DynamicNumber.optional(),
});

export const CitationsApi = {
  name: "Citations",
  schema: z.object({
    items: orBinding(z.array(CitationSchema).min(1).max(8)),
    weight: WeightSchema,
  }),
};

/** Domain pills after a localized "Sources" label. Confidence ≥0.8 has no
 *  marker; 0.5–0.8 a warning dot; below 0.5 a destructive dot, both with a
 *  localized tooltip. */
export const Citations = createComponentImplementation(CitationsApi, ({ props, context }) => {
  const { t } = useTranslation("templates");
  const items = asArray<unknown>(resolveDeep(props.items, context.dataContext))
    .map((raw) => {
      const c = asRecord(raw);
      const name = c ? asString(c.name)?.trim() : undefined;
      if (!c || !name) return null;
      return { name, url: safeUrl(c.url), confidence: asNumber(c.confidence) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;

  return (
    <div className="a2ui-citations" style={weightStyle(props.weight)}>
      <span>{t("surface.sources")}</span>
      {items.map((item, i) => {
        const marker =
          item.confidence !== undefined && item.confidence < 0.8 ? (
            <span
              className={`a2ui-cite__conf${item.confidence < 0.5 ? " a2ui-cite__conf--low" : ""}`}
              title={t("surface.lowConfidence")}
              role="img"
              aria-label={t("surface.lowConfidence")}
            />
          ) : null;
        return item.url ? (
          <a key={i} className="a2ui-cite" href={item.url} target="_blank" rel="noopener noreferrer">
            {item.name}
            {marker}
          </a>
        ) : (
          <span key={i} className="a2ui-cite">
            {item.name}
            {marker}
          </span>
        );
      })}
    </div>
  );
});
