/**
 * Sample A2UI surface for the Component Previews gallery: the hotel search
 * the backend's compiler tests use (its `hotel-surface` fixture), as the
 * `contentStructured` a `Surface` message row carries. Inert per the gallery
 * rules: every button is a link (`openUrl`) — nothing posts — and the one
 * `event` action in the "done" state is already stamped complete in the
 * data model, so a press is a no-op. Images are the gallery's inline chart
 * so the hero never hits the network.
 */

const SURFACE_ID = "00000000-0000-4000-8000-000000000001";
const CATALOG_ID = "https://app.agntchat.com/a2ui/catalogs/chat/v1/catalog.json";
const VERSION = "v0.9.1";

type Op = Record<string, unknown>;

function item(
  n: number,
  title: string,
  subtitle: string,
  price: Record<string, unknown>,
  rating: Record<string, unknown>,
  amenities: string[],
  room: string,
  area: string,
  cancellation: string,
  images: string[]
) {
  return {
    id: `item_${n}`,
    title,
    subtitle,
    alt: title,
    images,
    price,
    rating,
    amenities: amenities.map((label) => ({ label })),
    url: "https://example.com/hotels",
    kv: [
      { label: "Room", value: room, icon: "bed" },
      { label: "Area", value: area, icon: "map-pin" },
    ],
    fields: { room_type: room, area, cancellation },
  };
}

export function hotelSurfaceData(opts: {
  /** Image URL(s) every card shows — a data: URI in the gallery. */
  image: string;
  /** Number of hotels (1–3). */
  count: number;
  /** Include a `compare` event action, stamped complete on item 0. */
  completed?: boolean;
}): Record<string, unknown> {
  const actions: Op[] = [
    {
      id: "open_0",
      kind: "primary",
      label: "View deal",
      action: { functionCall: { call: "openUrl", args: { url: { path: "url" } } } },
    },
    {
      id: "map",
      kind: "secondary",
      icon: "map-pin",
      label: "Map",
      action: { functionCall: { call: "openUrl", args: { url: "https://example.com/map" } } },
    },
  ];
  if (opts.completed) {
    actions.push({
      id: "compare_hotel",
      kind: "secondary",
      label: "Compare",
      action: { event: { name: "compare_hotel", context: { item_id: { path: "id" }, title: { path: "title" } } } },
    });
  }

  const items = [
    item(0, "Hotel Adler", "300 m from venue",
      { amount: 128, currency: "EUR", per: "night", originalAmount: 150, discountPct: 15 },
      { value: 4.6, count: 1284, source: "Google" },
      ["Free WiFi", "Breakfast", "Gym", "Pool", "Bar", "Spa", "Parking"],
      "Deluxe King", "Mitte · Berlin", "Free cancellation until Sep 25", [opts.image, opts.image]),
    item(1, "Hotel Berg", "600 m from venue",
      { amount: 140, currency: "EUR", per: "night" },
      { value: 4.4, count: 880, source: "Google" },
      ["Free WiFi", "Breakfast", "Gym"],
      "Superior Double", "Mitte · Berlin", "Breakfast included", [opts.image]),
    item(2, "Hotel Central", "900 m from venue",
      { amount: 155, currency: "EUR", per: "night" },
      { value: 4.2, count: 760, source: "Google" },
      ["Free WiFi", "Gym", "Parking"],
      "Standard Double", "Kreuzberg · Berlin", "Non-refundable", [opts.image]),
  ].slice(0, Math.max(1, Math.min(3, opts.count)));

  const operations: Op[] = [
    { version: VERSION, createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
    {
      version: VERSION,
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          { id: "root", component: "Column", gap: "sm", children: ["title", "results", "sources"] },
          { id: "title", component: "Text", variant: "label", text: { path: "/title" } },
          {
            id: "results",
            component: "List",
            variant: "cards",
            maxVisible: 5,
            children: { path: "/items", componentId: "item_card" },
          },
          { id: "item_card", component: "Card", child: "item_col" },
          {
            id: "item_col",
            component: "Column",
            children: ["hero", "header", "amenities", "kv", "callout_cancellation", "actions"],
          },
          { id: "hero", component: "Hero", images: { path: "images" }, alt: { path: "alt" }, overlay: "price" },
          { id: "price", component: "Price", money: { path: "price" } },
          { id: "header", component: "Header", title: { path: "title" }, subtitle: { path: "subtitle" }, trailing: "rating" },
          {
            id: "rating",
            component: "Rating",
            value: { path: "rating/value" },
            count: { path: "rating/count" },
            source: { path: "rating/source" },
          },
          { id: "amenities", component: "ChipRow", items: { path: "amenities" }, max: 6 },
          { id: "kv", component: "KeyValue", items: { path: "kv" } },
          {
            id: "callout_cancellation",
            component: "Callout",
            text: { path: "fields/cancellation" },
            icon: "shield-check",
            tone: "success",
          },
          { id: "actions", component: "ActionBar", actions },
          { id: "sources", component: "Citations", items: { path: "/citations" } },
        ],
      },
    },
    {
      version: VERSION,
      updateDataModel: {
        surfaceId: SURFACE_ID,
        path: "/",
        value: {
          title: `${items.length} hotel${items.length === 1 ? "" : "s"} near the venue`,
          items,
          citations: [
            { name: "booking.com", url: "https://example.com", confidence: 0.9 },
            { name: "google.com", url: "https://example.com", confidence: 0.6 },
          ],
        },
      },
    },
  ];
  if (opts.completed) {
    // What the action endpoint appends after a press (first completion wins).
    operations.push({
      version: VERSION,
      updateDataModel: {
        surfaceId: SURFACE_ID,
        path: "/items/0/actions/compare_hotel",
        value: { participant_id: "preview-self", completed_at: "2026-07-10T15:05:00.000Z", result: "relayed" },
      },
    });
  }

  return {
    schema_version: "2.0",
    type: "Surface",
    data: {
      surface_id: SURFACE_ID,
      catalog_id: CATALOG_ID,
      protocol_version: VERSION,
      source: { result_type: "hotel", item_count: items.length, blueprint: "search" },
      operations,
    },
  };
}
