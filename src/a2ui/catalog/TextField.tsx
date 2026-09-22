import { useId } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { VisibleSchema, WeightSchema, asString, weightStyle } from "../shared";

export const TextFieldApi = {
  name: "TextField",
  schema: z.object({
    label: CommonSchemas.DynamicString,
    value: CommonSchemas.DynamicString.optional(),
    placeholder: CommonSchemas.DynamicString.optional(),
    variant: z.enum(["shortText", "longText", "number"]).optional(),
    checks: CommonSchemas.Checkable.shape.checks,
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

/** Two-way bound text input (the binder injects `setValue`). No obscured
 *  variant: a chat card never collects secrets. */
export const TextField = createComponentImplementation(TextFieldApi, ({ props }) => {
  const id = useId();
  const label = asString(props.label) ?? "";
  const value = asString(props.value) ?? "";
  const placeholder = asString(props.placeholder);
  const errors = props.validationErrors ?? [];
  const invalid = errors.length > 0;
  const cls = `a2ui-field__input${invalid ? " a2ui-field__input--invalid" : ""}`;
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.setValue(e.target.value);

  return (
    <div className="a2ui-field" style={weightStyle(props.weight)}>
      <label htmlFor={id} className="a2ui-field__label">
        {label}
      </label>
      {props.variant === "longText" ? (
        <textarea id={id} className={cls} rows={4} value={value} placeholder={placeholder} aria-invalid={invalid} onChange={onChange} />
      ) : (
        <input
          id={id}
          type={props.variant === "number" ? "number" : "text"}
          className={cls}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid}
          onChange={onChange}
        />
      )}
      {invalid && (
        <span className="a2ui-field__error" role="alert">
          {errors[0]}
        </span>
      )}
    </div>
  );
});
