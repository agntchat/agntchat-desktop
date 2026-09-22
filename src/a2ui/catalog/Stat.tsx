import { useTranslation } from "../host";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  SizeSchema,
  VisibleSchema, WeightSchema,
  asArray,
  asNumber,
  asRecord,
  asString,
  currentLocale,
  formatNumberValue,
  orBinding,
  resolveDeep,
  weightStyle,
} from "../shared";

const FormatSchema = z.enum(["number", "percent", "currency", "compact"]);

export const StatApi = {
  name: "Stat",
  schema: z.object({
    value: z.union([z.string(), z.number(), CommonSchemas.DataBinding, CommonSchemas.FunctionCall]),
    label: CommonSchemas.DynamicString.optional(),
    format: FormatSchema.optional(),
    currency: CommonSchemas.DynamicString.optional(),
    delta: orBinding(
      z.object({
        value: CommonSchemas.DynamicNumber,
        format: z.enum(["percent", "number", "currency"]).optional(),
        currency: CommonSchemas.DynamicString.optional(),
      })
    ).optional(),
    trend: orBinding(z.array(z.number()).min(2).max(60)).optional(),
    progress: orBinding(z.object({ value: CommonSchemas.DynamicNumber, max: CommonSchemas.DynamicNumber })).optional(),
    size: SizeSchema.optional(),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

function Sparkline({ data, first, last }: { data: number[]; first: string; last: string }) {
  const { t } = useTranslation("templates");
  const w = 80;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`)
    .join(" ");
  return (
    <svg className="a2ui-spark" viewBox={`0 0 ${w} ${h}`} role="img">
      <title>{t("surface.trend", { count: data.length, first, last })}</title>
      <polyline points={points} />
    </svg>
  );
}

/** A number that matters: tabular value, label beneath, delta with the sign
 *  always in the text (never colour alone), 80×24 sparkline, 4px progress. */
export const Stat = createComponentImplementation(StatApi, ({ props, context }) => {
  const size = props.size ?? "md";
  const rawValue = props.value as unknown;
  const numeric = asNumber(rawValue);
  const value =
    numeric !== undefined && (props.format || typeof rawValue === "number")
      ? formatNumberValue(numeric, props.format, asString(props.currency))
      : asString(rawValue) ?? "—";

  const delta = asRecord(resolveDeep(props.delta, context.dataContext));
  const deltaValue = delta ? asNumber(delta.value) : undefined;
  const trend = asArray<unknown>(resolveDeep(props.trend, context.dataContext)).filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
  const progress = asRecord(resolveDeep(props.progress, context.dataContext));
  const progressValue = progress ? asNumber(progress.value) : undefined;
  const progressMax = progress ? asNumber(progress.max) : undefined;

  const dir = deltaValue === undefined ? "flat" : deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "flat";
  const DeltaIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  let deltaText: string | null = null;
  if (deltaValue !== undefined) {
    const locale = currentLocale();
    const format = delta?.format === "percent" ? "percent" : delta?.format === "currency" ? "currency" : "number";
    if (format === "percent") {
      deltaText = new Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 2 }).format(deltaValue / 100);
    } else if (format === "currency") {
      deltaText = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: asString(delta?.currency) || asString(props.currency) || "USD",
        signDisplay: "exceptZero",
        maximumFractionDigits: Number.isInteger(deltaValue) ? 0 : 2,
      }).format(deltaValue);
    } else {
      deltaText = new Intl.NumberFormat(locale, { signDisplay: "exceptZero", maximumFractionDigits: 2 }).format(deltaValue);
    }
  }

  const label = asString(props.label);
  const showMeta = deltaText !== null || trend.length >= 2;
  const pct =
    progressValue !== undefined && progressMax !== undefined && progressMax > 0
      ? Math.max(0, Math.min(100, (100 * progressValue) / progressMax))
      : null;

  return (
    <div className={`a2ui-stat a2ui-stat--${size}`} style={weightStyle(props.weight)}>
      <div className="a2ui-stat__value">{value}</div>
      {showMeta && (
        <div className={`a2ui-stat__meta a2ui-delta--${dir}`}>
          {deltaText !== null && (
            <span className={`a2ui-delta a2ui-delta--${dir}`}>
              <DeltaIcon className="a2ui-i" aria-hidden="true" />
              {deltaText}
            </span>
          )}
          {trend.length >= 2 && (
            <Sparkline
              data={trend}
              first={formatNumberValue(trend[0] ?? 0, undefined)}
              last={formatNumberValue(trend[trend.length - 1] ?? 0, undefined)}
            />
          )}
        </div>
      )}
      {pct !== null && (
        <div
          className={`a2ui-progress${pct >= 100 ? " a2ui-progress--full" : ""}`}
          role="progressbar"
          aria-valuenow={progressValue}
          aria-valuemin={0}
          aria-valuemax={progressMax}
          aria-label={label}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      {label && <div className="a2ui-stat__label">{label}</div>}
    </div>
  );
});
