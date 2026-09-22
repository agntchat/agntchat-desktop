import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { SizeSchema, WeightSchema, asNumber, asRecord, asString, currentLocale, orBinding, resolveDeep, weightStyle } from "../shared";

const MoneySchema = z.object({
  amount: CommonSchemas.DynamicNumber,
  currency: CommonSchemas.DynamicString,
  per: CommonSchemas.DynamicString.optional(),
  originalAmount: CommonSchemas.DynamicNumber.optional(),
  discountPct: CommonSchemas.DynamicNumber.optional(),
});

export const PriceApi = {
  name: "Price",
  // The catalog types `money` as an object; the Phase 0 compiler binds the
  // whole object (`money: {path: "price"}`), so a binding is accepted too.
  schema: z.object({
    money: orBinding(MoneySchema),
    size: SizeSchema.optional(),
    weight: WeightSchema,
  }),
};

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currentLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Amount 16/600 (lg 20/700), `/per` 12 muted, original struck through,
 *  `-N%` in success. Always Intl.NumberFormat in the viewer's locale. */
export const Price = createComponentImplementation(PriceApi, ({ props, context }) => {
  const money = asRecord(resolveDeep(props.money, context.dataContext));
  const amount = money ? asNumber(money.amount) : undefined;
  const currency = money ? asString(money.currency) : undefined;
  if (amount === undefined || !currency) return null;
  const per = asString(money?.per);
  const original = asNumber(money?.originalAmount);
  const discount = asNumber(money?.discountPct);
  const size = props.size ?? "md";
  const discountText =
    discount !== undefined && discount > 0
      ? new Intl.NumberFormat(currentLocale(), { style: "percent", maximumFractionDigits: 0 }).format(-discount / 100)
      : null;

  return (
    <span className={`a2ui-price a2ui-price--${size}`} style={weightStyle(props.weight)}>
      <span className="a2ui-price__amount">{formatMoney(amount, currency)}</span>
      {per && <span className="a2ui-price__per">/{per}</span>}
      {original !== undefined && original > amount && (
        <s className="a2ui-price__orig">{formatMoney(original, currency)}</s>
      )}
      {discountText && <span className="a2ui-price__disc">{discountText}</span>}
    </span>
  );
});
