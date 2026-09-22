import { useId } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { CardLabelContext, ToneSchema, WeightSchema, renderChild, weightStyle, type ChildRef } from "../shared";

export const CardApi = {
  name: "Card",
  schema: z.object({
    child: CommonSchemas.ComponentId,
    tone: ToneSchema.optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    weight: WeightSchema,
  }),
};

/** One result. Owns border, background, radius, padding and shadow; a tone
 *  draws the left rule for status cards. Labelled by its Header's title. */
export const Card = createComponentImplementation(CardApi, ({ props, buildChild }) => {
  const labelId = useId();
  const tone = props.tone && props.tone !== "neutral" ? ` a2ui-card--${props.tone}` : "";
  const density = props.density === "compact" ? " a2ui-card--compact" : "";
  return (
    <CardLabelContext.Provider value={labelId}>
      <article
        role="group"
        aria-labelledby={labelId}
        className={`a2ui-card${tone}${density}`}
        style={weightStyle(props.weight)}
      >
        {renderChild(props.child as ChildRef, buildChild)}
      </article>
    </CardLabelContext.Provider>
  );
});
