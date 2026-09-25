import { create } from "zustand";
import * as api from "../lib/api";

export interface CatalogModel {
  id: string;
  label: string;
  /** CLI-backend models carry per-runtime API IDs:
   *    { anthropic: "claude-opus-4-7",
   *      bedrock: "anthropic.claude-opus-4-7",
   *      vertex: "claude-opus-4-7" }
   *  Used by the org config UI for picking which runtimes a model is
   *  available on. The model dropdown is filtered server-side. */
  runtimes?: Record<string, string>;
  /** An older model the server still offers but no longer leads with.
   *  Omitted on current models. The server orders each provider's list
   *  current-first, so pickers show the current ones up front and file
   *  these under "Other models" (see `splitModels`). The `auto` entry is
   *  never legacy. */
  legacy?: boolean;
  /** On the `auto` entry only: the models auto may pick on this provider,
   *  with their tier (1 light / 2 standard / 3 heavy), in pick order — what
   *  the per-agent exclusion checklist offers. */
  tierModels?: { id: string; tier: number; legacy?: boolean }[];
}

/** Partition a provider's models into current and legacy ("Other models"),
 *  preserving the server's order within each group. */
export function splitModels(models: CatalogModel[]): {
  current: CatalogModel[];
  other: CatalogModel[];
} {
  const current: CatalogModel[] = [];
  const other: CatalogModel[] = [];
  for (const m of models) (m.legacy ? other : current).push(m);
  return { current, other };
}

export interface CatalogProvider {
  id: string;
  label: string;
  requiresLlmKey: boolean;
  supportedModes: string[];
  models: CatalogModel[];
  /** Connection (auth/runtime) options for CLI backends — e.g.
   *  ["subscription", "anthropic", "bedrock", "vertex"]. Absent for
   *  API providers (their connection is implied by the API key). */
  cliConnections?: string[];
}

/**
 * A vendor the user can store an LLM API key for — what Settings -> LLM Keys
 * renders. A SUPERSET of the key-requiring entries in `providers`: TypeSafe's
 * Jev answers typed questions rather than chat turns, so it takes a key but is
 * not an agent backend and deliberately never appears in a backend picker.
 * Filtering `providers` on `requiresLlmKey` (what this used to do) can't see
 * those, so the server sends them as their own list.
 */
export interface LlmKeyProvider {
  id: string;
  label: string;
}

interface ModelCatalogState {
  providers: CatalogProvider[];
  /** Vendors the LLM Keys tab offers. Not the same set as `providers`
   *  — see LlmKeyProvider. */
  llmKeyProviders: LlmKeyProvider[];
  loaded: boolean;
  loading: boolean;
  ensureLoaded: () => Promise<void>;
  /**
   * Fetch the UNFILTERED global catalog (scope=global). For the org Models
   * admin UI, which must see every model to build the per-org allow-list —
   * the cached `providers` here are participant-FILTERED (correct for
   * agent-config pickers) and would hide any model not already allowed,
   * making newly-added models impossible to enable. Not cached: always a
   * fresh fetch so the admin sees the current global set.
   */
  fetchGlobalCatalog: () => Promise<CatalogProvider[]>;
  modelsFor: (providerId: string) => CatalogModel[];
  supportedModesFor: (providerId: string) => string[];
  requiresLlmKey: (providerId: string) => boolean;
  cliConnectionsFor: (providerId: string) => string[];
  providerLabel: (id: string) => string;
  /** Display label for a stored model id, resolved from the backend
   *  catalog (the single source of truth). `backend` narrows the search
   *  to that provider's models; omit it to search every provider. Falls
   *  back to a light cleanup of the raw id for unknown/custom ids or
   *  before the catalog has loaded. */
  modelLabel: (modelId: string | null | undefined, backend?: string | null) => string | null;
}

let inflight: Promise<void> | null = null;

export const useModelCatalog = create<ModelCatalogState>((set, get) => ({
  providers: [],
  llmKeyProviders: [],
  loaded: false,
  loading: false,

  ensureLoaded: async () => {
    if (get().loaded || get().loading) {
      return inflight ?? Promise.resolve();
    }
    set({ loading: true });
    inflight = api
      .request<{ providers: CatalogProvider[]; llmKeyProviders?: LlmKeyProvider[] }>("/api/models/providers")
      .then((data) => {
        set({
          providers: data.providers ?? [],
          llmKeyProviders: data.llmKeyProviders ?? [],
          loaded: true,
          loading: false,
        });
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[modelCatalog] failed to load", e);
        set({ loading: false });
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  fetchGlobalCatalog: async () => {
    const data = await api.request<{ providers: CatalogProvider[] }>(
      "/api/models/providers?scope=global"
    );
    return data.providers ?? [];
  },

  modelsFor: (providerId) => {
    const p = get().providers.find((p) => p.id === providerId);
    return p?.models ?? [];
  },

  supportedModesFor: (providerId) => {
    const p = get().providers.find((p) => p.id === providerId);
    return p?.supportedModes ?? ["single_shot"];
  },

  requiresLlmKey: (providerId) => {
    const p = get().providers.find((p) => p.id === providerId);
    return p?.requiresLlmKey ?? true;
  },

  cliConnectionsFor: (providerId) => {
    const p = get().providers.find((p) => p.id === providerId);
    return p?.cliConnections ?? [];
  },

  providerLabel: (id) => {
    const p = get().providers.find((p) => p.id === id);
    return p?.label ?? id;
  },

  modelLabel: (modelId, backend) => {
    if (!modelId) return null;
    const { providers } = get();
    const scoped = backend ? providers.filter((p) => p.id === backend) : providers;
    const search = scoped.length > 0 ? scoped : providers;
    for (const p of search) {
      const m = p.models.find((m) => m.id === modelId);
      if (m) return m.label;
    }
    return modelId
      .replace(/^(anthropic|openai|google|meta|mistral)\//i, "")
      .replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
  },
}));
