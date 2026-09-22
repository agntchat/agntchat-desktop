import { ChevronDown } from "lucide-react";
import type { DataContext } from "@a2ui/web_core/v0_9";
import { getInitials, resolveIcon } from "../host";
import { plainText, type CardSummaryIds, type ComponentLookup } from "../rowSummary";
import { absoluteDataPath, asArray, asNumber, asRecord, asString, currentLocale } from "../shared";
import { formatMoney } from "./Price";

const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

/** Resolve one authored prop (a literal or a `{path}`) for the item at `basePath`. */
function resolveAt(dataContext: DataContext, basePath: string | undefined, raw: unknown): unknown {
  const rec = asRecord(raw);
  if (rec && typeof rec.path === "string" && Object.keys(rec).length === 1) {
    return dataContext.dataModel.get(absoluteDataPath(basePath, rec.path));
  }
  return raw;
}

/**
 * The trailing column's compact rendering of a `Rating` (one star + value),
 * `Price` (amount + unit), `Stat` (value) or single-chip `ChipRow`. Drawn
 * here from the component model rather than through `buildChild`: the node
 * layer only resolves a list's own children, not a card's descendants.
 */
function TrailPart({
  id,
  components,
  dataContext,
  basePath,
}: {
  id: string;
  components: ComponentLookup;
  dataContext: DataContext;
  basePath?: string;
}) {
  const node = components.get(id);
  if (!node) return null;
  const p = node.properties;
  const at = (raw: unknown) => resolveAt(dataContext, basePath, raw);
  switch (node.type) {
    case "Rating": {
      const value = asNumber(at(p.value));
      if (value === undefined) return null;
      const scale = p.scale === 10 ? 10 : 5;
      const text = new Intl.NumberFormat(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
      return (
        <span className="a2ui-rating a2ui-row__rating">
          <span className="a2ui-rating__stars" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d={STAR} fill="currentColor" />
            </svg>
          </span>
          <span className="a2ui-rating__value">{scale === 10 ? `${text}/10` : text}</span>
        </span>
      );
    }
    case "Price": {
      const money = asRecord(at(p.money));
      const amount = money ? asNumber(at(money.amount)) : undefined;
      const currency = money ? asString(at(money.currency)) : undefined;
      if (amount === undefined || !currency) return null;
      const per = asString(at(money?.per));
      return (
        <span className="a2ui-price a2ui-price--sm">
          <span className="a2ui-price__amount">{formatMoney(amount, currency)}</span>
          {per && <span className="a2ui-price__per">/{per}</span>}
        </span>
      );
    }
    case "Stat": {
      const value = at(p.value);
      const text = typeof value === "number" ? new Intl.NumberFormat(currentLocale()).format(value) : asString(value);
      return text ? <span className="a2ui-row__stat">{text}</span> : null;
    }
    case "ChipRow": {
      const first = asArray<unknown>(at(p.items))[0];
      const rec = asRecord(first);
      const label = rec ? asString(at(rec.label)) : asString(first);
      if (!label) return null;
      const tone = rec && typeof rec.tone === "string" && rec.tone !== "neutral" ? ` a2ui-chip--${rec.tone}` : "";
      return <span className={`a2ui-chip${tone}`}>{label}</span>;
    }
    default:
      return null;
  }
}

/**
 * One compact row of a `List variant=rows`: thumbnail · title/subtitle ·
 * trailing column (the header's trailing child over the hero's overlay) ·
 * chevron. A button, so keyboard and screen readers get the expand state.
 */
export function RowSummary({
  ids,
  components,
  dataContext,
  basePath,
  expanded,
  visited,
  onToggle,
}: {
  ids: CardSummaryIds;
  components: ComponentLookup;
  dataContext: DataContext;
  basePath?: string;
  expanded: boolean;
  visited: boolean;
  onToggle: () => void;
}) {
  const hero = ids.hero ? components.get(ids.hero)?.properties : undefined;
  const header = ids.header ? components.get(ids.header)?.properties : undefined;
  const callout = ids.callout ? components.get(ids.callout)?.properties : undefined;

  const image = hero
    ? asArray<unknown>(resolveAt(dataContext, basePath, hero.images)).find((u): u is string => typeof u === "string" && u.length > 0)
    : undefined;
  const title = (header && asString(resolveAt(dataContext, basePath, header.title))) ?? "";
  const subtitle = header ? asString(resolveAt(dataContext, basePath, header.subtitle)) : undefined;
  const overline = header ? asString(resolveAt(dataContext, basePath, header.overline)) : undefined;
  const leading = header ? asRecord(header.leading) : undefined;
  const chipText = callout ? asString(resolveAt(dataContext, basePath, callout.text)) : undefined;
  const chipTone = callout && typeof callout.tone === "string" && callout.tone !== "neutral" ? callout.tone : "info";

  let lead: React.ReactNode = null;
  if (image) {
    lead = <img className="a2ui-row__thumb" src={image} alt="" loading="lazy" />;
  } else if (leading) {
    const Icon = resolveIcon(asString(leading.icon));
    const leadImage = asString(resolveAt(dataContext, basePath, leading.image));
    if (Icon) {
      lead = (
        <div className="a2ui-row__lead a2ui-row__lead--icon" aria-hidden="true">
          <Icon className="a2ui-i" />
        </div>
      );
    } else if (leadImage) {
      lead = (
        <div className={`a2ui-row__lead a2ui-row__lead--${leading.variant === "logo" ? "logo" : "avatar"}`}>
          <img src={leadImage} alt="" />
        </div>
      );
    } else if (leading.image !== undefined) {
      lead = (
        <div className="a2ui-row__lead a2ui-row__lead--avatar" aria-hidden="true">
          {getInitials(title)}
        </div>
      );
    }
  }

  return (
    <button
      type="button"
      className={`a2ui-row${expanded ? " a2ui-row--expanded" : ""}${visited ? " a2ui-row--visited" : ""}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {lead}
      <div className="a2ui-row__main">
        {overline && <div className="a2ui-overline">{overline}</div>}
        <div className="a2ui-row__title">{title}</div>
        {(subtitle || chipText) && (
          <div className="a2ui-row__sub">
            {subtitle && <span className="a2ui-row__subtitle">{subtitle}</span>}
            {chipText && <span className={`a2ui-chip a2ui-chip--${chipTone} a2ui-row__chip`}>{plainText(chipText)}</span>}
          </div>
        )}
      </div>
      {ids.trailing && (
        <div className="a2ui-row__trail">
          <TrailPart id={ids.trailing} components={components} dataContext={dataContext} basePath={basePath} />
        </div>
      )}
      {ids.overlay && (
        <div className="a2ui-row__trail">
          <TrailPart id={ids.overlay} components={components} dataContext={dataContext} basePath={basePath} />
        </div>
      )}
      <ChevronDown className="a2ui-i a2ui-row__chevron" aria-hidden="true" />
    </button>
  );
}
