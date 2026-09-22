import { useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { getInitials } from "../host";
import { LinkSchema, VisibleSchema, WeightSchema, asRecord, asString, isExternalUrl, resolveDeep, safeUrl, weightStyle } from "../shared";

export const ImageApi = {
  name: "Image",
  schema: z.object({
    url: CommonSchemas.DynamicString,
    alt: CommonSchemas.DynamicString,
    variant: z.enum(["thumbnail", "avatar", "logo"]).optional(),
    link: LinkSchema.optional(),
    weight: WeightSchema,
    visible: VisibleSchema,
  }),
};

/** A single non-hero image: 64px thumbnail, 40px avatar disc or 24px logo.
 *  A failed load falls back to the alt text's initials in an accent disc. */
export const Image = createComponentImplementation(ImageApi, ({ props, context }) => {
  const [failed, setFailed] = useState(false);
  const url = asString(props.url);
  const alt = asString(props.alt) ?? "";
  const variant = props.variant ?? "thumbnail";
  const link = safeUrl(asRecord(resolveDeep(props.link, context.dataContext))?.url);

  const img =
    url && !failed ? (
      <img className={`a2ui-image a2ui-image--${variant}`} src={url} alt={alt} onError={() => setFailed(true)} />
    ) : (
      <span className={`a2ui-image a2ui-image--${variant} a2ui-image__fallback`} role="img" aria-label={alt}>
        {getInitials(alt)}
      </span>
    );

  if (link) {
    return (
      <a
        href={link}
        target={isExternalUrl(link) ? "_blank" : undefined}
        rel={isExternalUrl(link) ? "noopener noreferrer" : undefined}
        style={{ display: "inline-flex", ...weightStyle(props.weight) }}
      >
        {img}
      </a>
    );
  }
  return <span style={{ display: "inline-flex", ...weightStyle(props.weight) }}>{img}</span>;
});
