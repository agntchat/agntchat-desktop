import { useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { resolveIcon, useTranslation } from "../host";
import {
  IconNameSchema,
  ToneSchema,
  WeightSchema,
  asArray,
  asRecord,
  asString,
  orBinding,
  resolveDeep,
  weightStyle,
} from "../shared";

const ChipSchema = z.object({
  label: CommonSchemas.DynamicString,
  icon: IconNameSchema.optional(),
  tone: ToneSchema.optional(),
});

export const ChipRowApi = {
  name: "ChipRow",
  schema: z.object({
    items: orBinding(z.array(ChipSchema).min(1).max(12)),
    max: z.number().int().min(1).max(8).optional(),
    weight: WeightSchema,
  }),
};

/** Short scannable tags in pills. Beyond `max` a "+N" control expands the
 *  row in place. Labels are values only — never "Label: value". */
export const ChipRow = createComponentImplementation(ChipRowApi, ({ props, context }) => {
  const { t } = useTranslation("templates");
  const [expanded, setExpanded] = useState(false);
  const chips = asArray<unknown>(resolveDeep(props.items, context.dataContext))
    .map((raw) => {
      const chip = asRecord(raw);
      const label = chip ? asString(chip.label)?.trim() : asString(raw)?.trim();
      if (!label) return null;
      return {
        label,
        Icon: resolveIcon(chip ? asString(chip.icon) : undefined),
        tone: chip && typeof chip.tone === "string" && chip.tone !== "neutral" ? chip.tone : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (chips.length === 0) return null;

  const max = props.max ?? 6;
  const visible = expanded ? chips : chips.slice(0, max);
  const hidden = chips.length - visible.length;

  return (
    <div className="a2ui-chips" style={weightStyle(props.weight)}>
      {visible.map((chip, i) => (
        <span key={i} className={`a2ui-chip${chip.tone ? ` a2ui-chip--${chip.tone}` : ""}`}>
          {chip.Icon && <chip.Icon className="a2ui-i" aria-hidden="true" />}
          {chip.label}
        </span>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className="a2ui-chip a2ui-chip--more"
          aria-expanded={false}
          aria-label={t("surface.showMoreCount", { count: hidden })}
          onClick={() => setExpanded(true)}
        >
          {t("surface.moreChips", { count: hidden })}
        </button>
      )}
    </div>
  );
});
