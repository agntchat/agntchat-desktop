import { useId, useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { ChevronDown } from "lucide-react";
import { resolveIcon } from "../host";
import { IconNameSchema, WeightSchema, asString, renderChild, weightStyle, type ChildRef } from "../shared";

export const SectionApi = {
  name: "Section",
  schema: z.object({
    title: CommonSchemas.DynamicString,
    icon: IconNameSchema.optional(),
    child: CommonSchemas.ComponentId,
    collapsible: z.boolean().optional(),
    collapsed: z.boolean().optional(),
    weight: WeightSchema,
  }),
};

/** A titled block: uppercase label with icon, hairline above (never below).
 *  The section boundary is the divider — there is no standalone Divider. */
export const Section = createComponentImplementation(SectionApi, ({ props, buildChild }) => {
  const [open, setOpen] = useState(!(props.collapsible && props.collapsed));
  const bodyId = useId();
  const Icon = resolveIcon(props.icon);
  const title = asString(props.title) ?? "";
  const label = (
    <>
      {Icon && <Icon className="a2ui-i" aria-hidden="true" />}
      <span>{title}</span>
    </>
  );
  return (
    <section className="a2ui-section" style={weightStyle(props.weight)}>
      <h4 className="a2ui-section__title">
        {props.collapsible ? (
          <button
            type="button"
            className="a2ui-section__toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
          >
            {label}
            <ChevronDown className="a2ui-i a2ui-caret" aria-hidden="true" />
          </button>
        ) : (
          label
        )}
      </h4>
      {open && <div id={bodyId}>{renderChild(props.child as ChildRef, buildChild)}</div>}
    </section>
  );
});
