import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { MarkdownContent, resolveIcon } from "../host";
import {
  IconNameSchema,
  LinkSchema,
  ToneSchema,
  VisibleSchema, WeightSchema,
  asRecord,
  asString,
  isExternalUrl,
  resolveDeep,
  safeUrl,
  weightStyle,
} from "../shared";

export const CalloutApi = {
  name: "Callout",
  schema: z.object({
    text: CommonSchemas.DynamicString,
    icon: IconNameSchema.optional(),
    tone: ToneSchema.optional(),
    link: LinkSchema.optional(),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

/** The pull-quote / status line: 2px left rule, 15/600, icon in the tone
 *  colour; warning and destructive also tint the rule. */
export const Callout = createComponentImplementation(CalloutApi, ({ props, context }) => {
  const text = asString(props.text)?.trim();
  if (!text) return null;
  const tone = props.tone ?? "info";
  const Icon = resolveIcon(props.icon);
  const link = safeUrl(asRecord(resolveDeep(props.link, context.dataContext))?.url);
  const body = <MarkdownContent content={text} />;
  return (
    <div className={`a2ui-callout a2ui-callout--${tone}`} style={weightStyle(props.weight)}>
      {Icon && <Icon className="a2ui-i" aria-hidden="true" />}
      {link ? (
        <a
          className="a2ui-callout__text"
          href={link}
          target={isExternalUrl(link) ? "_blank" : undefined}
          rel={isExternalUrl(link) ? "noopener noreferrer" : undefined}
        >
          {body}
        </a>
      ) : (
        <div className="a2ui-callout__text">{body}</div>
      )}
    </div>
  );
});
