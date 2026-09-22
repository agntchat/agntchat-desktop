import type React from "react";
import { Catalog, ResolvedBinding, createBasicCatalogFunctions } from "@a2ui/web_core/v0_9";
import { useSignalValue, type NodeViewProps, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { currentLocale } from "../host";
import { useDynamicBoolean } from "../shared";
import { ActionBar } from "./ActionBar";
import { Callout } from "./Callout";
import { Card } from "./Card";
import { ChipRow } from "./ChipRow";
import { ChoicePicker } from "./ChoicePicker";
import { Citations } from "./Citations";
import { Column } from "./Column";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { Image } from "./Image";
import { KeyValue } from "./KeyValue";
import { List } from "./List";
import { Price } from "./Price";
import { Rating } from "./Rating";
import { Row } from "./Row";
import { Section } from "./Section";
import { Slot } from "./Slot";
import { Stat } from "./Stat";
import { Steps } from "./Steps";
import { Table } from "./Table";
import { Tabs } from "./Tabs";
import { Text } from "./Text";
import { TextField } from "./TextField";
import { Toggle } from "./Toggle";

/** Must equal `catalogId` in every `createSurface` the backend emits
 *  (`backend/priv/a2ui/chat-catalog.v1.json` → `$id`). */
export const CATALOG_ID = "https://app.agntchat.com/a2ui/catalogs/chat/v1/catalog.json";

/**
 * Every component honours `visible` (a DynamicBoolean on every schema in
 * chat-catalog.v1.json): bound and false → the node renders nothing. Done
 * once here rather than in 24 render functions. The node layer (`view`) has
 * already resolved the binding; the legacy `render` path resolves it live
 * through the data context.
 */
function withVisibility(impl: ReactComponentImplementation): ReactComponentImplementation {
  const InnerView = impl.view;
  const InnerRender = impl.render;
  const view: React.FC<NodeViewProps> | undefined = InnerView
    ? ({ node, buildChild }) => {
        const resolved = useSignalValue(node.props) as Record<string, unknown> | undefined;
        const raw = resolved?.visible;
        const visible = raw instanceof ResolvedBinding ? raw.value : raw;
        if (visible === false) return null;
        return <InnerView node={node} buildChild={buildChild} />;
      }
    : undefined;
  if (view) view.displayName = `${impl.name}.visible`;
  const render: ReactComponentImplementation["render"] = ({ context, buildChild }) => {
    const visible = useDynamicBoolean(
      context.dataContext,
      (context.componentModel.properties as { visible?: unknown }).visible
    );
    if (visible === false) return null;
    return <InnerRender context={context} buildChild={buildChild} />;
  };
  return { ...impl, render, view };
}

/** The 24 components of chat-catalog.v1.json. */
export const agntchatComponents: ReactComponentImplementation[] = [
  Card,
  Column,
  Row,
  List,
  Section,
  Tabs,
  Header,
  Text,
  Image,
  Hero,
  KeyValue,
  ChipRow,
  Callout,
  Stat,
  Price,
  Rating,
  Steps,
  Table,
  ActionBar,
  Citations,
  TextField,
  ChoicePicker,
  Toggle,
  Slot,
].map(withVisibility);

/** The basic-catalog functions the chat catalog declares. Host functions
 *  (openUrl, sendEmail, saveDraft, copyText, enableNotifications, …) are
 *  executed by `ActionBar` itself, which is where the completion stamp and
 *  busy/done state live; `openUrl` here only covers a stray value binding. */
const DECLARED_FUNCTIONS = new Set([
  "required",
  "regex",
  "length",
  "numeric",
  "email",
  "formatString",
  "formatNumber",
  "formatCurrency",
  "formatDate",
  "pluralize",
  "openUrl",
  "and",
  "or",
  "not",
]);

const catalogs = new Map<string, Catalog<ReactComponentImplementation>>();

/** One catalog per viewer locale (the formatting functions carry it). */
export function agntchatCatalog(locale: string = currentLocale()): Catalog<ReactComponentImplementation> {
  let catalog = catalogs.get(locale);
  if (!catalog) {
    catalog = new Catalog<ReactComponentImplementation>(
      CATALOG_ID,
      agntchatComponents,
      createBasicCatalogFunctions({ locale }).filter((f) => DECLARED_FUNCTIONS.has(f.name))
    );
    catalogs.set(locale, catalog);
  }
  return catalog;
}
