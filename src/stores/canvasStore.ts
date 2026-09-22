import { create } from "zustand";
import {
  listCanvasDefinitions,
  getCanvasDefinition,
  createCanvasDefinition,
  updateCanvasDefinition,
  deleteCanvasDefinition,
  validateCanvasDefinition,
  previewCanvasDefinition,
} from "../lib/api";
import type { CanvasDefinitionSummary, CanvasPreview } from "../lib/api";

/**
 * Canvases store with full CRUD. `selectedId === "new"` is the sentinel for
 * the in-progress create form.
 *
 * List endpoint returns summaries (no full `definition` JSON). When the user
 * picks an existing canvas, we lazy-fetch the full record and cache it in
 * `details[id]`. CRUD actions only mutate local state *after* the server
 * confirms, so a failed request leaves the list consistent with the server.
 * List-fetch failures populate `error` for the view to surface as a banner;
 * per-item actions re-throw so the editor can render inline.
 */
interface CanvasState {
  definitions: CanvasDefinitionSummary[];
  loading: boolean;
  loadedAt: number;
  error: string | null;
  selectedId: string | null;
  /** Full records keyed by id — populated as the user selects each one. */
  details: Record<string, CanvasDefinitionSummary>;
  detailLoading: Record<string, boolean>;

  fetchDefinitions: () => Promise<void>;
  selectCanvas: (id: string | null) => void;
  fetchDetail: (id: string) => Promise<void>;
  createDefinition: (attrs: {
    name: string;
    description?: string;
    definition: Record<string, unknown>;
    isPublished?: boolean;
  }) => Promise<CanvasDefinitionSummary>;
  updateDefinition: (
    id: string,
    attrs: Partial<{
      name: string;
      description: string;
      definition: Record<string, unknown>;
      isPublished: boolean;
    }>
  ) => Promise<CanvasDefinitionSummary>;
  deleteDefinition: (id: string) => Promise<void>;
  validateDefinition: (
    definition: Record<string, unknown>
  ) => Promise<{ valid: boolean; errors: string[] }>;
  previewDefinition: (definition: Record<string, unknown>) => Promise<CanvasPreview>;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  definitions: [],
  loading: false,
  loadedAt: 0,
  error: null,
  selectedId: null,
  details: {},
  detailLoading: {},

  fetchDefinitions: async () => {
    set({ loading: true, error: null });
    try {
      const { definitions } = await listCanvasDefinitions();
      set({ definitions, loadedAt: Date.now() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load canvases";
      console.warn("[canvas] fetch failed", e);
      set({ error: msg });
    } finally {
      set({ loading: false });
    }
  },

  selectCanvas: (id) => {
    set({ selectedId: id });
    if (id && id !== "new" && !get().details[id]) {
      get().fetchDetail(id);
    }
  },

  fetchDetail: async (id) => {
    set((s) => ({ detailLoading: { ...s.detailLoading, [id]: true } }));
    try {
      const full = await getCanvasDefinition(id);
      set((s) => ({
        details: { ...s.details, [id]: full },
        detailLoading: { ...s.detailLoading, [id]: false },
      }));
    } catch (e) {
      console.warn(`[canvas] fetchDetail(${id}) failed`, e);
      set((s) => ({ detailLoading: { ...s.detailLoading, [id]: false } }));
    }
  },

  createDefinition: async (attrs) => {
    const { definition } = await createCanvasDefinition(attrs);
    set((s) => ({
      definitions: [definition, ...s.definitions],
      details: { ...s.details, [definition.id]: definition },
    }));
    return definition;
  },

  updateDefinition: async (id, attrs) => {
    const { definition } = await updateCanvasDefinition(id, attrs);
    set((s) => ({
      definitions: s.definitions.map((d) => (d.id === id ? definition : d)),
      details: { ...s.details, [id]: definition },
    }));
    return definition;
  },

  deleteDefinition: async (id) => {
    await deleteCanvasDefinition(id);
    set((s) => {
      const nextDetails = { ...s.details };
      delete nextDetails[id];
      return {
        definitions: s.definitions.filter((d) => d.id !== id),
        details: nextDetails,
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    });
  },

  validateDefinition: (definition) => validateCanvasDefinition(definition),
  previewDefinition: (definition) => previewCanvasDefinition(definition),
}));
