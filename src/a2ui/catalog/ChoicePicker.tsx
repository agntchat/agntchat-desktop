import { useId } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { WeightSchema, asArray, asRecord, asString, weightStyle } from "../shared";

export const ChoicePickerApi = {
  name: "ChoicePicker",
  schema: z.object({
    label: CommonSchemas.DynamicString.optional(),
    variant: z.enum(["multipleSelection", "mutuallyExclusive"]).optional(),
    options: z.array(z.object({ label: CommonSchemas.DynamicString, value: z.string() })).min(2).max(8),
    value: CommonSchemas.DynamicStringList,
    displayStyle: z.enum(["chips", "list"]).optional(),
    checks: CommonSchemas.Checkable.shape.checks,
    weight: WeightSchema,
  }),
};

/** Select one or more of ≤8 options, bound to a string array. */
export const ChoicePicker = createComponentImplementation(ChoicePickerApi, ({ props }) => {
  const groupName = useId();
  const label = asString(props.label);
  const values = asArray<string>(props.value).filter((v): v is string => typeof v === "string");
  const exclusive = (props.variant ?? "mutuallyExclusive") === "mutuallyExclusive";
  const options = asArray<unknown>(props.options)
    .map((raw) => {
      const o = asRecord(raw);
      const value = o ? asString(o.value) : undefined;
      if (!o || value === undefined) return null;
      return { value, label: asString(o.label) ?? value };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const errors = props.validationErrors ?? [];

  const toggle = (value: string) => {
    if (exclusive) {
      props.setValue([value]);
      return;
    }
    props.setValue(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  const chips = (props.displayStyle ?? "chips") === "chips";
  return (
    <div className="a2ui-field" role="group" aria-label={label} style={weightStyle(props.weight)}>
      {label && <span className="a2ui-field__label">{label}</span>}
      <div className={`a2ui-choice${chips ? "" : " a2ui-choice--list"}`}>
        {options.map((opt) => {
          const selected = values.includes(opt.value);
          if (chips) {
            return (
              <button key={opt.value} type="button" className="a2ui-choice__chip" aria-pressed={selected} onClick={() => toggle(opt.value)}>
                {opt.label}
              </button>
            );
          }
          return (
            <label key={opt.value} className="a2ui-choice__option">
              <input
                type={exclusive ? "radio" : "checkbox"}
                name={exclusive ? groupName : undefined}
                checked={selected}
                onChange={() => toggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
      {errors.length > 0 && (
        <span className="a2ui-field__error" role="alert">
          {errors[0]}
        </span>
      )}
    </div>
  );
});
