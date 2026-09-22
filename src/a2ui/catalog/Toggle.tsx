import { useEffect, useId, useRef } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { postSurfaceAction, surfaceWriteBody } from "../actions";
import {
  VisibleSchema,
  WeightSchema,
  absoluteDataPath,
  asString,
  bindingPathOf,
  useSurfaceHost,
  weightStyle,
} from "../shared";

export const ToggleApi = {
  name: "Toggle",
  schema: z.object({
    label: CommonSchemas.DynamicString,
    value: CommonSchemas.DynamicBoolean,
    description: CommonSchemas.DynamicString.optional(),
    checks: CommonSchemas.Checkable.shape.checks,
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

/** How long a run of flips coalesces into one server write. */
const WRITE_DEBOUNCE_MS = 300;

/**
 * A labelled switch bound two-way to a boolean. The flip lands in the local
 * data model at once (the binder's setter). On a canvas surface — the host
 * targets a `surface` — the last value of a 300 ms run is posted as
 * `invoke updateSurfaceData {writes}` under this component's id; the server
 * recomputes derived visibility and broadcasts. Inside a chat card (a
 * `message` target, or none) it only updates locally: a card asks a yes/no
 * with two ActionBar actions instead.
 */
export const Toggle = createComponentImplementation(ToggleApi, ({ props, context }) => {
  const id = useId();
  const host = useSurfaceHost();
  const checked = props.value === true;
  const label = asString(props.label) ?? "";
  const description = asString(props.description);
  const errors = props.validationErrors ?? [];

  const rawPath = bindingPathOf((context.componentModel.properties as { value?: unknown }).value);
  const writePath = rawPath ? absoluteDataPath(context.dataContext.path, rawPath) : undefined;
  const postsToSurface = host.target?.kind === "surface" && writePath !== undefined;

  const timer = useRef<number | null>(null);
  /** The value the server last agreed to — restored when a write fails. */
  const settled = useRef(checked);
  const pending = useRef<boolean | null>(null);
  useEffect(() => {
    if (pending.current === null) settled.current = checked;
  }, [checked]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const flush = async () => {
    timer.current = null;
    const value = pending.current;
    pending.current = null;
    if (value === null || !host.target || !writePath) return;
    if (value === settled.current) return;
    try {
      const res = await postSurfaceAction(host.target, surfaceWriteBody(context.componentModel.id, [{ path: writePath, value }]));
      if (res.operation) host.applyOperations([res.operation]);
      if (res.result && res.result.ok === false) throw new Error(res.result.text ?? "write refused");
      settled.current = value;
    } catch (e) {
      console.error("A2UI toggle write failed:", e);
      if (pending.current === null) props.setValue(settled.current);
    }
  };

  const onToggle = () => {
    const next = !checked;
    props.setValue(next);
    if (!postsToSurface) return;
    pending.current = next;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), WRITE_DEBOUNCE_MS);
  };

  return (
    <div className="a2ui-toggle" style={weightStyle(props.weight)}>
      <button
        type="button"
        role="switch"
        id={id}
        className="a2ui-toggle__switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={onToggle}
      >
        <span className="a2ui-toggle__thumb" aria-hidden="true" />
      </button>
      <div className="a2ui-toggle__text">
        <label id={`${id}-label`} htmlFor={id} className="a2ui-toggle__label">
          {label}
        </label>
        {description && (
          <span id={`${id}-desc`} className="a2ui-toggle__desc">
            {description}
          </span>
        )}
        {errors.length > 0 && (
          <span className="a2ui-field__error" role="alert">
            {errors[0]}
          </span>
        )}
      </div>
    </div>
  );
});
