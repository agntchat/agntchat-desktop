import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { Children, GapSchema, WeightSchema, weightStyle, type ChildRef } from "../shared";

export const RowApi = {
  name: "Row",
  schema: z.object({
    children: CommonSchemas.ChildList,
    gap: GapSchema.optional(),
    align: z.enum(["start", "center", "end"]).optional(),
    justify: z.enum(["start", "between", "end"]).optional(),
    wrap: z.boolean().optional(),
    weight: WeightSchema,
  }),
};

/** The component id behind a child token: template instances carry a
 *  `-[scope]` suffix and repeated references a `#n` suffix. */
function componentIdOf(ref: ChildRef): string {
  const id = typeof ref === "string" ? ref : ref.id;
  return id.replace(/-\[.*$/, "").replace(/#\d+$/, "");
}

/** Horizontal flex. A row of `Stat`s is the stat strip; a row of more than
 *  two other blocks stacks on a phone-width bubble (the renderer decides). */
export const Row = createComponentImplementation(RowApi, ({ props, buildChild, context }) => {
  const refs = (Array.isArray(props.children) ? props.children : []) as ChildRef[];
  const types = refs.map((ref) => context.surfaceComponents.get(componentIdOf(ref))?.type);
  const allStats = types.length > 0 && types.every((t) => t === "Stat");
  const stacks = refs.length > 2 && !types.every((t) => t === "ChipRow" || t === "Stat");
  const cls = [
    "a2ui-row",
    `a2ui-gap--${props.gap ?? "md"}`,
    `a2ui-align--${props.align ?? "center"}`,
    `a2ui-justify--${props.justify ?? "start"}`,
    props.wrap ? "a2ui-row--wrap" : "",
    allStats ? "a2ui-row--stats" : "",
    stacks ? "a2ui-row--stacks" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={weightStyle(props.weight)}>
      <Children refs={props.children} buildChild={buildChild} />
    </div>
  );
});
