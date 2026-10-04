// Auto-link agent/human prose: scans the markdown source and wraps
// detected URLs, emails, phone numbers, and US street addresses in
// markdown link syntax so the renderer's existing <a> handler produces
// tappable affordances. Skips code spans, code blocks, and existing
// markdown links/images so we don't double-wrap.

const SKIP_PATTERN =
  /(```[\s\S]*?```|`[^`\n]*`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\))/g;

const URL_RE = /\bhttps?:\/\/[^\s<>"'\)\]]+/gi;
const WWW_RE = /\b(?<![@\/])www\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s<>"'\)\]]*/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;

// Phone: require at least one separator (paren/dash/dot/space) between
// the area code and the rest so bare 10-digit IDs don't match. Allows
// optional +country prefix.
const PHONE_RE =
  /(?<!\d)(?:\+?\d{1,3}[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g;

// US street address: house number + 1-5 name words + street suffix,
// optionally followed by a direction ("NW") and ", City" / ", City, ST" /
// ", City, ST 12345". Trailing period after suffix tolerated.
//
// Deliberately strict, because this runs over every message and artifact:
// - Case-sensitive. Name words and the suffix must be capitalised (or an
//   ordinal like "5th"), so "3 of the drafts" is prose, not an address.
// - The suffix must be a whole word. Without the boundary "St" matched the
//   start of "stack" and "Pl" the start of "plan".
// - Spaces and tabs only between parts, so a match never crosses a line.
const STREET_SUFFIX =
  "Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct|Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Circle|Cir|Trail|Trl|Square|Sq";

const NAME_WORD = String.raw`(?:[A-Z][A-Za-z'\-]*|\d{1,3}(?:st|nd|rd|th))`;
const CITY_WORD = String.raw`[A-Z][A-Za-z'\-]*`;

const ADDRESS_RE = new RegExp(
  String.raw`\b\d{1,6}[ \t]+(?:[NSEW]\.?[ \t]+)?(?:${NAME_WORD}[ \t]+){1,5}(?:` +
    STREET_SUFFIX +
    String.raw`)\b\.?(?:[ \t]+(?:NE|NW|SE|SW|N|S|E|W)\b)?` +
    // Optional ", City [Words]" followed by optional ", ST" and optional " 12345[-1234]".
    String.raw`(?:,[ \t]+${CITY_WORD}(?:[ \t]+${CITY_WORD}){0,4}(?:,[ \t]+[A-Z]{2}(?:[ \t]+\d{5}(?:-\d{4})?)?)?)?`,
  "g",
);

// Trailing punctuation that should not be part of a URL/address match.
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;

type LinkMatch = {
  start: number;
  end: number;
  text: string;
  href: string;
};

export function linkifyMarkdown(source: string): string {
  if (!source || typeof source !== "string") return source;
  // Cheap reject when nothing plausible is present. Any digit passes: a
  // house number can be a single one.
  if (!/[@:]|www\.|\d/.test(source)) return source;

  const out: string[] = [];
  let lastEnd = 0;
  for (const match of source.matchAll(SKIP_PATTERN)) {
    const idx = match.index ?? 0;
    if (idx > lastEnd) out.push(transformSegment(source.slice(lastEnd, idx)));
    out.push(match[0]);
    lastEnd = idx + match[0].length;
  }
  if (lastEnd < source.length) out.push(transformSegment(source.slice(lastEnd)));
  return out.join("");
}

function transformSegment(segment: string): string {
  const matches: LinkMatch[] = [];

  pushMatches(matches, segment, URL_RE, (m) => {
    const trimmed = m.replace(TRAILING_PUNCT, "");
    return { text: trimmed, href: trimmed, consumed: trimmed.length };
  });
  pushMatches(matches, segment, WWW_RE, (m) => {
    const trimmed = m.replace(TRAILING_PUNCT, "");
    return {
      text: trimmed,
      href: `https://${trimmed}`,
      consumed: trimmed.length,
    };
  });
  pushMatches(matches, segment, EMAIL_RE, (m) => ({
    text: m,
    href: `mailto:${m}`,
    consumed: m.length,
  }));
  pushMatches(matches, segment, PHONE_RE, (m) => {
    const digits = m.replace(/[^\d+]/g, "");
    return { text: m, href: `tel:${digits}`, consumed: m.length };
  });
  pushMatches(matches, segment, ADDRESS_RE, (m) => {
    const trimmed = m.replace(/[\s,]+$/, "");
    return {
      text: trimmed,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`,
      consumed: trimmed.length,
    };
  });

  if (matches.length === 0) return segment;

  // Sort by start ascending, then longest first. Drop overlaps.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: LinkMatch[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) {
      kept.push(m);
      cursor = m.end;
    }
  }

  let result = "";
  let p = 0;
  for (const m of kept) {
    result += segment.slice(p, m.start);
    result += `[${escapeLinkText(m.text)}](${m.href})`;
    p = m.end;
  }
  result += segment.slice(p);
  return result;
}

function pushMatches(
  out: LinkMatch[],
  segment: string,
  re: RegExp,
  toLink: (m: string) => { text: string; href: string; consumed: number },
): void {
  for (const match of segment.matchAll(re)) {
    const idx = match.index ?? 0;
    const raw = match[0];
    const { text, href, consumed } = toLink(raw);
    if (!text) continue;
    out.push({ start: idx, end: idx + consumed, text, href });
  }
}

function escapeLinkText(s: string): string {
  // Square brackets inside link text break markdown link syntax. Strip
  // them (uncommon in URLs/emails/addresses) so the renderer doesn't
  // mis-parse the wrapped link.
  return s.replace(/[\[\]]/g, "");
}
