import { useState } from "react";
import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { ImageGalleryLightbox, useTranslation } from "../host";
import { WeightSchema, asArray, asString, orBinding, renderChild, weightStyle, type ChildRef } from "../shared";

export const HeroApi = {
  name: "Hero",
  schema: z.object({
    images: orBinding(z.array(z.string()).min(1).max(20)),
    alt: CommonSchemas.DynamicString,
    ratio: z.enum(["wide", "square"]).optional(),
    overlay: CommonSchemas.ComponentId.optional(),
    weight: WeightSchema,
  }),
};

/**
 * Full-bleed media at the top of a card, with a photo-count badge and a
 * lightbox. 16:9 capped at 200px (160px on phones). One `Price` or
 * `ChipRow` may sit bottom-left on a scrim. An image that fails to load
 * collapses the hero (no placeholder strip); the overlay child is kept so
 * the price is not lost with the photo.
 */
export const Hero = createComponentImplementation(HeroApi, ({ props, buildChild }) => {
  const { t } = useTranslation("templates");
  const images = asArray<unknown>(props.images).filter((u): u is string => typeof u === "string" && u.length > 0);
  const alt = asString(props.alt) ?? "";
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const first = images[0];
  const overlay = props.overlay ? renderChild(props.overlay as ChildRef, buildChild) : null;

  if (!first || failed) {
    return overlay ? (
      <div className="a2ui-hero-fallback" style={weightStyle(props.weight)}>
        {overlay}
      </div>
    ) : null;
  }

  const label = images.length > 1 ? `${alt}, ${t("surface.photos", { count: images.length })}` : alt;
  return (
    <>
      <button
        type="button"
        className={`a2ui-hero${props.ratio === "square" ? " a2ui-hero--square" : ""}`}
        style={weightStyle(props.weight)}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        <img className="a2ui-hero__img" src={first} alt="" loading="lazy" onError={() => setFailed(true)} />
        {overlay && <div className="a2ui-hero__overlay">{overlay}</div>}
        {images.length > 1 && (
          <div className="a2ui-hero__count" aria-hidden="true">
            {t("surface.photos", { count: images.length })}
          </div>
        )}
      </button>
      {open && <ImageGalleryLightbox images={images} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
});
