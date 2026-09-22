import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * Full-screen image gallery (parity with web's ImageGalleryLightbox and
 * mobile's ImageGalleryModal). Used by the A2UI `Hero` component. Esc
 * closes, arrow keys page.
 */
export function ImageGalleryLightbox({
  images,
  alt,
  onClose,
}: {
  images: string[];
  alt: string;
  onClose: () => void;
}) {
  const { t: tCommon } = useTranslation("common");
  const [index, setIndex] = useState(0);

  const prev = useCallback(
    () => setIndex((i) => (i - 1 + images.length) % images.length),
    [images.length]
  );
  const next = useCallback(
    () => setIndex((i) => (i + 1) % images.length),
    [images.length]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, prev, next]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label={tCommon("close")}
        autoFocus
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>

      <img
        src={images[index]}
        alt={alt}
        className="max-h-[85vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label={tCommon("previous")}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            aria-label={tCommon("next")}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm text-white">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}
