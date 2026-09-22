import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { Check } from "lucide-react";
import { WeightSchema, asArray, asRecord, asString, orBinding, resolveDeep, weightStyle } from "../shared";

const StateSchema = z.enum(["pending", "current", "done", "failed"]);

const StepSchema = z.object({
  label: CommonSchemas.DynamicString,
  detail: CommonSchemas.DynamicString.optional(),
  at: CommonSchemas.DynamicString.optional(),
  state: StateSchema.optional(),
});

export const StepsApi = {
  name: "Steps",
  schema: z.object({
    items: orBinding(z.array(StepSchema).min(2).max(12)),
    variant: z.enum(["timeline", "progress"]).optional(),
    weight: WeightSchema,
  }),
};

type StepState = z.infer<typeof StateSchema>;

/** Ordered progress as an `<ol>`: a vertical rail with a dot per step, or
 *  a horizontal stepper for ≤5 steps. `aria-current="step"` on the current. */
export const Steps = createComponentImplementation(StepsApi, ({ props, context }) => {
  const steps = asArray<unknown>(resolveDeep(props.items, context.dataContext))
    .map((raw) => {
      const step = asRecord(raw);
      const label = step ? asString(step.label)?.trim() : undefined;
      if (!step || !label) return null;
      const state = (["pending", "current", "done", "failed"] as const).includes(step.state as StepState)
        ? (step.state as StepState)
        : "pending";
      return { label, detail: asString(step.detail), at: asString(step.at), state };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (steps.length === 0) return null;

  const progress = props.variant === "progress" && steps.length <= 5;
  if (progress) {
    const current = steps.find((s) => s.state === "current") ?? steps[steps.length - 1];
    return (
      <div style={weightStyle(props.weight)}>
        <ol className="a2ui-stepper">
          {steps.map((step, i) => (
            <li key={i} className={`a2ui-step--${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
              <span className="a2ui-step__dot" aria-hidden="true">
                {step.state === "done" && <Check />}
              </span>
              <span className="a2ui-sr">{step.label}</span>
            </li>
          ))}
        </ol>
        {current && <div className="a2ui-stepper__label">{current.label}</div>}
      </div>
    );
  }

  return (
    <ol className="a2ui-steps" style={weightStyle(props.weight)}>
      {steps.map((step, i) => (
        <li key={i} className={`a2ui-step a2ui-step--${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="a2ui-step__dot" aria-hidden="true">
            {step.state === "done" && <Check />}
          </span>
          <div>
            <div className="a2ui-step__label">{step.label}</div>
            {step.detail && <div className="a2ui-step__detail">{step.detail}</div>}
          </div>
          <div className="a2ui-step__at">{step.at ?? ""}</div>
        </li>
      ))}
    </ol>
  );
});
