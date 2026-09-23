/** The public legal documents, rendered by the marketing site
 *  (agntchat_website repo, src/content/legal/<locale>); the backend's /legal
 *  routes redirect there. Linked from the signup consent copy and the
 *  blocking PolicyGate. */
export type LegalDoc = "terms" | "privacy";

/** URL of a legal document in the reader's language. The marketing site
 *  serves one translation per app locale, English at the root and every
 *  other locale under `/<locale>`. Pass the app's resolved i18n language. */
export function legalUrl(doc: LegalDoc, language: string | undefined): string {
  const locale = (language ?? "en").split("-")[0];
  const prefix = locale === "en" ? "" : `/${locale}`;
  return `https://agntchat.com${prefix}/legal/${doc}`;
}
