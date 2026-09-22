import { useContext, useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { getInitials, resolveIcon } from "../host";
import {
  CardLabelContext,
  IconNameSchema,
  WeightSchema,
  asRecord,
  asString,
  renderChild,
  resolveDeep,
  weightStyle,
  type ChildRef,
} from "../shared";

export const HeaderApi = {
  name: "Header",
  schema: z.object({
    title: CommonSchemas.DynamicString,
    subtitle: CommonSchemas.DynamicString.optional(),
    overline: CommonSchemas.DynamicString.optional(),
    leading: z
      .union([
        z.object({ icon: IconNameSchema }),
        z.object({ image: CommonSchemas.DynamicString, variant: z.enum(["avatar", "logo"]).optional() }),
      ])
      .optional(),
    trailing: CommonSchemas.ComponentId.optional(),
    weight: WeightSchema,
  }),
};

/** The card's identity block: overline 12/500 uppercase, title 16/600 (two
 *  lines max), subtitle 14 muted, optional leading icon/avatar and a
 *  trailing Price/Rating/Stat aligned with the title. No default icon. */
export const Header = createComponentImplementation(HeaderApi, ({ props, buildChild, context }) => {
  const labelId = useContext(CardLabelContext);
  const [imageFailed, setImageFailed] = useState(false);
  const title = asString(props.title) ?? "";
  const subtitle = asString(props.subtitle);
  const overline = asString(props.overline);
  const leading = asRecord(resolveDeep(props.leading, context.dataContext));

  let lead: React.ReactNode = null;
  if (leading) {
    const Icon = resolveIcon(asString(leading.icon));
    const image = asString(leading.image);
    const variant = leading.variant === "logo" ? "logo" : "avatar";
    if (Icon) {
      lead = (
        <div className="a2ui-header__lead a2ui-header__lead--icon" aria-hidden="true">
          <Icon className="a2ui-i" />
        </div>
      );
    } else if (image && !imageFailed) {
      lead = (
        <div className={`a2ui-header__lead a2ui-header__lead--${variant}`}>
          <img src={image} alt="" onError={() => setImageFailed(true)} />
        </div>
      );
    } else if (image || leading.image) {
      // Image missing or 404: the first letters of the title in an accent disc.
      lead = (
        <div className="a2ui-header__lead a2ui-header__lead--avatar" aria-hidden="true">
          {getInitials(title)}
        </div>
      );
    }
  }

  return (
    <div className="a2ui-header" style={weightStyle(props.weight)}>
      {lead}
      <div className="a2ui-header__text">
        {overline && <div className="a2ui-overline">{overline}</div>}
        <h3 id={labelId} className="a2ui-title">
          {title}
        </h3>
        {subtitle && <p className="a2ui-subtitle">{subtitle}</p>}
      </div>
      {props.trailing ? (
        <div className="a2ui-header__trail">{renderChild(props.trailing as ChildRef, buildChild)}</div>
      ) : null}
    </div>
  );
});
