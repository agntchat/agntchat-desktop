import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { Children, GapSchema, VisibleSchema, WeightSchema, weightStyle } from "../shared";

export const ColumnApi = {
  name: "Column",
  schema: z.object({
    children: CommonSchemas.ChildList,
    gap: GapSchema.optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

export const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) => (
  <div
    className={`a2ui-column a2ui-gap--${props.gap ?? "md"} a2ui-align--${props.align ?? "stretch"}`}
    style={weightStyle(props.weight)}
  >
    <Children refs={props.children} buildChild={buildChild} />
  </div>
));
