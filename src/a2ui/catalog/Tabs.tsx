import { useId, useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { VisibleSchema, WeightSchema, asString, renderChild, weightStyle, type ChildRef } from "../shared";

export const TabsApi = {
  name: "Tabs",
  schema: z.object({
    tabs: z
      .array(z.object({ title: CommonSchemas.DynamicString, child: CommonSchemas.ComponentId }))
      .min(2)
      .max(5),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

interface TabEntry {
  title?: unknown;
  child?: ChildRef;
}

/** Facets of one card. `selectedIndex` is renderer-local, never in the model. */
export const Tabs = createComponentImplementation(TabsApi, ({ props, buildChild }) => {
  const [selected, setSelected] = useState(0);
  const baseId = useId();
  const tabs = (Array.isArray(props.tabs) ? props.tabs : []) as TabEntry[];
  const current = tabs[Math.min(selected, tabs.length - 1)];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (selected + 1) % tabs.length : (selected - 1 + tabs.length) % tabs.length;
    setSelected(next);
    (document.getElementById(`${baseId}-tab-${next}`) as HTMLElement | null)?.focus();
  };

  return (
    <div className="a2ui-tabs" style={weightStyle(props.weight)}>
      <div role="tablist" className="a2ui-tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            id={`${baseId}-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={i === selected}
            aria-controls={`${baseId}-panel-${i}`}
            tabIndex={i === selected ? 0 : -1}
            className="a2ui-tabs__tab"
            onClick={() => setSelected(i)}
          >
            {asString(tab.title) ?? ""}
          </button>
        ))}
      </div>
      <div id={`${baseId}-panel-${selected}`} role="tabpanel" aria-labelledby={`${baseId}-tab-${selected}`}>
        {current ? renderChild(current.child, buildChild) : null}
      </div>
    </div>
  );
});
