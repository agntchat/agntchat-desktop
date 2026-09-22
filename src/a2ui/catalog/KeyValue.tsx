import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { resolveIcon } from "../host";
import {
  IconNameSchema,
  LinkSchema,
  WeightSchema,
  asArray,
  asRecord,
  asString,
  isExternalUrl,
  orBinding,
  resolveDeep,
  safeUrl,
  weightStyle,
} from "../shared";

const ItemSchema = z.object({
  label: CommonSchemas.DynamicString,
  value: CommonSchemas.DynamicString,
  icon: IconNameSchema.optional(),
  link: LinkSchema.optional(),
  mono: z.boolean().optional(),
});

export const KeyValueApi = {
  name: "KeyValue",
  schema: z.object({
    items: orBinding(z.array(ItemSchema).min(1).max(12)),
    layout: z.enum(["rows", "grid"]).optional(),
    weight: WeightSchema,
  }),
};

/** Aligned facts as a `<dl>`: 96px label column, linked values in primary,
 *  `mono` values in the mono face. An item with an empty value is dropped;
 *  `grid` is two columns on ≥480px bubbles. */
export const KeyValue = createComponentImplementation(KeyValueApi, ({ props, context }) => {
  const items = asArray<unknown>(resolveDeep(props.items, context.dataContext))
    .map((raw) => {
      const item = asRecord(raw);
      if (!item) return null;
      const value = asString(item.value)?.trim();
      if (!value) return null;
      return {
        label: asString(item.label) ?? "",
        value,
        Icon: resolveIcon(asString(item.icon)),
        link: safeUrl(asRecord(item.link)?.url),
        mono: item.mono === true,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;

  return (
    <dl className={`a2ui-kv${props.layout === "grid" ? " a2ui-kv--grid" : ""}`} style={weightStyle(props.weight)}>
      {items.map((item, i) => (
        <KeyValueRow key={i} {...item} />
      ))}
    </dl>
  );
});

function KeyValueRow({
  label,
  value,
  Icon,
  link,
  mono,
}: {
  label: string;
  value: string;
  Icon: ReturnType<typeof resolveIcon>;
  link: string | null;
  mono: boolean;
}) {
  const long = label.trim().split(/\s+/).length > 2;
  return (
    <>
      <dt className={long ? "a2ui-kv__long" : undefined}>
        {Icon && <Icon className="a2ui-i" aria-hidden="true" />}
        {label}
      </dt>
      <dd className={mono ? "a2ui-mono" : undefined}>
        {link ? (
          <a
            href={link}
            target={isExternalUrl(link) ? "_blank" : undefined}
            rel={isExternalUrl(link) ? "noopener noreferrer" : undefined}
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </>
  );
}
