/**
 * Host adapter — the ONE file under `src/a2ui/` that is desktop's own.
 * Everything else in this directory is a byte-for-byte copy of the web
 * client's Surface renderer (synced from the monorepo, drift-checked in CI)
 * and imports its client-specific pieces from here and nowhere else. The
 * web copy of this file exports exactly the same names with web's
 * implementations; keep the two signatures equal.
 */
import i18n from "../i18n";
import { request } from "../lib/api";
import { openExternal as tauriOpenExternal } from "../lib/openExternal";

export { useTranslation } from "react-i18next";
export { MarkdownContent } from "../components/messages/MarkdownContent";
export { ImageGalleryLightbox } from "../components/messages/ImageGalleryLightbox";
export { resolveIcon } from "../lib/cardIcons";
export { getInitials } from "../lib/utils";
export type { Message } from "../lib/api";

/** The viewer's UI language — the catalog's formatting functions carry it. */
export function currentLocale(): string {
  return i18n.language || "en";
}

/** Authenticated `POST` against the backend; resolves with the parsed JSON
 *  body and rejects on a non-2xx status. */
export function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

/** Open an http(s)/mailto/tel URL outside the app (the system browser). */
export function openExternal(url: string): void {
  tauriOpenExternal(url);
}
