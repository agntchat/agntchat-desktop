/**
 * vCard 3.0 for the `saveContact` catalog function on web and desktop
 * (mobile hands the same args to the native new-contact form instead).
 * Args are the `save_contact` tool's own names — `name`, `organization`,
 * `job_title`, `phone`, `email`, `address`, `url`, `note` — bound by the
 * server from the card's `contact` map (`docs/reference/a2ui-surfaces.md`
 * § Actions). Version 3.0 because it is what Apple Contacts, Android and
 * Outlook all import without complaint; 4.0 still trips older importers.
 */
import { asString } from "./shared";

const PREFIXES = new Set(["dr", "dr.", "prof", "prof.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "mx", "mx.", "herr", "frau", "sir", "dame"]);

/** Split a display name into the vCard `N` parts: prefix, given, family. */
export function splitName(full: string): { prefix: string; given: string; family: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const prefix = parts.length > 1 && PREFIXES.has(first.toLowerCase()) ? (parts.shift() ?? "") : "";
  if (parts.length <= 1) return { prefix, given: parts[0] ?? "", family: "" };
  const family = parts.pop() ?? "";
  return { prefix, given: parts.join(" "), family };
}

/** Escape a text value for a vCard property (RFC 6350 § 3.4). */
function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;");
}

/** Fold lines longer than 75 octets with a leading space (RFC 6350 § 3.2). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  out.push(rest);
  return out.join("\r\n");
}

export function buildVCard(args: Record<string, unknown>): string {
  const name = asString(args.name)?.trim() || "Contact";
  const { prefix, given, family } = splitName(name);
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${esc(family)};${esc(given)};;${esc(prefix)};`, `FN:${esc(name)}`];
  const org = asString(args.organization)?.trim();
  const title = asString(args.job_title)?.trim();
  const phone = asString(args.phone)?.trim();
  const email = asString(args.email)?.trim();
  const address = asString(args.address)?.trim();
  const url = asString(args.url)?.trim();
  const note = asString(args.note)?.trim();
  if (org) lines.push(`ORG:${esc(org)}`);
  if (title) lines.push(`TITLE:${esc(title)}`);
  if (phone) lines.push(`TEL;TYPE=voice:${esc(phone)}`);
  if (email) lines.push(`EMAIL;TYPE=internet:${esc(email)}`);
  // One-line addresses go in the street slot; importers show the line as written.
  if (address) lines.push(`ADR;TYPE=work:;;${esc(address)};;;;`);
  if (url) lines.push(`URL:${esc(url.startsWith("http") ? url : `https://${url}`)}`);
  if (note) lines.push(`NOTE:${esc(note)}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** `<name>.vcf`, with nothing a filesystem or the OS opener would object to. */
export function vcardFilename(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "contact"}.vcf`;
}
