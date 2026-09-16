import { open as tauriOpen } from "@tauri-apps/plugin-shell";

/** Open a URL in the system browser — Tauri native with window.open fallback. */
export function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

/** Schemes the shell plugin's `open` scope accepts (tauri.conf.json →
 *  plugins.shell.open = true ⇒ its default `mailto|tel|https?` regex). */
const EXTERNAL_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

/**
 * Route every click on an external `<a href>` through {@link openExternal}.
 *
 * The webview has no browser chrome, so an anchor's default action goes
 * nowhere: `target="_blank"` asks for a new window the app never creates,
 * and a same-window navigation would replace the app itself. The shell
 * plugin ships a `<body>`-level click sniffer for `_blank` anchors, but a
 * bubble-phase listener that far up the tree is fragile — anything between
 * the anchor and `<body>` that stops propagation silently disables it, and
 * it ignores links without `target`. Listening in the capture phase on
 * `document` runs before any React handler, so message links rendered by
 * shared web/desktop components (markdown bodies, result cards, file cards)
 * open without each of them knowing they are inside Tauri.
 *
 * "External" means an absolute http(s)/mailto/tel URL on a different origin
 * than the app page (tauri://localhost in release, the Vite port in dev).
 * Relative and same-origin anchors are left alone.
 */
export function installExternalLinkHandler() {
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }
      if (!EXTERNAL_SCHEMES.includes(url.protocol)) return;
      if (url.origin === window.location.origin) return;

      // preventDefault stops the webview's own (dead-end) navigation;
      // stopPropagation keeps the shell plugin's body sniffer from opening
      // the same URL a second time.
      event.preventDefault();
      event.stopPropagation();
      openExternal(url.href);
    },
    true
  );
}
