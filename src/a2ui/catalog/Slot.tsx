import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { useTranslation } from "../host";
import { SLOT_NAMES, VisibleSchema, WeightSchema, useSlotRenderers, weightStyle, type SlotName } from "../shared";

export const SlotApi = {
  name: "Slot",
  schema: z.object({
    name: z.enum(SLOT_NAMES),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

const LABEL_KEYS: Record<SlotName, string> = {
  message_list: "surface.slot.messageList",
  composer: "surface.slot.composer",
  typing_indicator: "surface.slot.typingIndicator",
};

/**
 * A region the HOST renders inside a long-lived surface (a canvas): the
 * conversation's message feed, the composer, the typing indicator. Not
 * content — the host provides the live UI through `SlotContext`; without a
 * renderer for the name (the studio preview, a client without that feature)
 * a labelled dashed placeholder marks where it goes.
 */
export const Slot = createComponentImplementation(SlotApi, ({ props }) => {
  const { t } = useTranslation("templates");
  const renderers = useSlotRenderers();
  const name = props.name as SlotName;
  const render = renderers[name];
  if (render) return <>{render()}</>;
  return (
    <div className={`a2ui-slot a2ui-slot--${name}`} role="note" style={weightStyle(props.weight)}>
      <span className="a2ui-slot__label">{t(LABEL_KEYS[name] ?? "surface.slot.messageList")}</span>
    </div>
  );
});
