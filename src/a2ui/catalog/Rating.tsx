import { useId } from "react";
import { useTranslation } from "../host";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { VisibleSchema, WeightSchema, asNumber, asString, currentLocale, weightStyle } from "../shared";

export const RatingApi = {
  name: "Rating",
  schema: z.object({
    value: CommonSchemas.DynamicNumber,
    scale: z.union([z.literal(5), z.literal(10)]).optional(),
    count: CommonSchemas.DynamicNumber.optional(),
    source: CommonSchemas.DynamicString.optional(),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

/** Half-star row in `warning`, value 12/500, `(count)` and source muted.
 *  Scale 10 renders one star and `8.4/10`. `role="img"` with a localized
 *  label; the stars themselves are hidden from assistive tech. */
export const Rating = createComponentImplementation(RatingApi, ({ props }) => {
  const { t } = useTranslation("templates");
  // useId() yields `:r1:`-style ids; colons are not valid inside url(#…).
  const gradientId = "a2ui-half-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const value = asNumber(props.value);
  if (value === undefined) return null;
  const scale = props.scale === 10 ? 10 : 5;
  const count = asNumber(props.count);
  const source = asString(props.source);
  const locale = currentLocale();
  const valueText = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  const countText = count !== undefined ? new Intl.NumberFormat(locale).format(count) : undefined;

  let label = t("surface.rated", { value: valueText, scale });
  if (countText) label += " " + t("surface.ratedBy", { count: countText });
  if (source) label += " " + t("surface.ratedOn", { source });

  const stars: React.ReactNode[] = [];
  const starCount = scale === 10 ? 1 : 5;
  for (let i = 1; i <= starCount; i++) {
    const fill =
      scale === 10 || value >= i
        ? "currentColor"
        : value >= i - 0.5
          ? `url(#${gradientId})`
          : "var(--color-border-strong)";
    stars.push(
      <svg key={i} viewBox="0 0 24 24" aria-hidden="true">
        <path d={STAR} fill={fill} />
      </svg>
    );
  }

  return (
    <span className="a2ui-rating" role="img" aria-label={label} style={weightStyle(props.weight)}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId}>
            <stop offset="50%" stopColor="currentColor" />
            <stop offset="50%" stopColor="var(--color-border-strong)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="a2ui-rating__stars" aria-hidden="true">
        {stars}
      </span>
      <span className="a2ui-rating__value" aria-hidden="true">
        {scale === 10 ? `${valueText}/10` : valueText}
      </span>
      {(countText || source) && (
        <span className="a2ui-rating__meta" aria-hidden="true">
          {countText ? `(${countText})` : ""}
          {countText && source ? " " : ""}
          {source ?? ""}
        </span>
      )}
    </span>
  );
});
