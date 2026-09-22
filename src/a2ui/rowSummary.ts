/**
 * The compact row a `List variant=rows` shows for each item — derived from
 * the SAME card template the expanded row renders in full, so a blueprint
 * needs no second template (`docs/feature-proposals/a2ui/blueprints.md`,
 * family 1): `Hero` → 64px thumbnail, `Header` → title/subtitle (+ its
 * `trailing`), `Hero.overlay` → the trailing column, the first `Callout`
 * → a toned chip; everything else waits for the row to expand.
 */

/** The slice of a component model the walk reads. */
export interface ComponentLike {
  type: string;
  properties: Record<string, unknown>;
}

export interface ComponentLookup {
  get(id: string): ComponentLike | undefined;
}

export interface CardSummaryIds {
  /** The card's `Hero` (thumbnail source). */
  hero?: string;
  /** The hero's overlay child (a `Price` or `ChipRow`), shown in the trailing column. */
  overlay?: string;
  /** The card's `Header` (title, subtitle, overline, leading). */
  header?: string;
  /** The header's trailing child (`Rating`, `Price`, `Stat`, single-chip `ChipRow`). */
  trailing?: string;
  /** The first `Callout` in the body (a toned chip on the row). */
  callout?: string;
}

const CONTAINERS = new Set(["Column", "Row"]);
const MAX_DEPTH = 6;

function childIds(props: Record<string, unknown>): string[] {
  const children = props.children;
  if (Array.isArray(children)) return children.filter((c): c is string => typeof c === "string");
  return [];
}

/** Walk a card template (by component id) and pick out the row's parts. */
export function summarizeCard(components: ComponentLookup, cardId: string): CardSummaryIds {
  const out: CardSummaryIds = {};
  const card = components.get(cardId);
  if (!card) return out;
  const start = card.type === "Card" && typeof card.properties.child === "string" ? card.properties.child : cardId;

  const visit = (id: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const node = components.get(id);
    if (!node) return;
    switch (node.type) {
      case "Hero":
        if (!out.hero) {
          out.hero = id;
          if (typeof node.properties.overlay === "string") out.overlay = node.properties.overlay;
        }
        return;
      case "Header":
        if (!out.header) {
          out.header = id;
          if (typeof node.properties.trailing === "string") out.trailing = node.properties.trailing;
        }
        return;
      case "Callout":
        if (!out.callout) out.callout = id;
        return;
      default:
        if (CONTAINERS.has(node.type)) for (const child of childIds(node.properties)) visit(child, depth + 1);
    }
  };
  visit(start, 0);
  return out;
}

/** The authored component id behind a node-layer instance id
 *  (`item_card-[/items/0]` → `item_card`); a plain id comes back as is. */
export function templateIdOf(id: string | undefined): string | undefined {
  return id?.replace(/-\[.*\]$/, "");
}

/** Markdown a `Callout` carries, reduced to the plain text a chip can hold. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
