import { useEffect, useState } from "react";
import { request } from "./api";
import { EMPTY_VOCAB, type AgentType, type PersonaVocab } from "./agentVocab";

/**
 * Preset starting points for the Create Agent wizard. A preset is nothing
 * more than a named bundle of the wizard's existing state fields — picking
 * one pre-seeds role/tone/specialties/description/instructions, and every
 * later step stays fully editable. `instructions` flows into the soul via
 * the server builder's "Additional Instructions" block.
 *
 * The catalog is served by the backend (`GET /api/agents/presets`,
 * `Agentchat.AgentPresets`) — the single source of truth shared by web,
 * desktop, and mobile. Nothing here is hardcoded; we only fetch, cache, and
 * derive the i18n key names from each preset's `id`. The same response
 * carries the persona vocabulary (`tones`, `specialtiesByRole`) the tone and
 * specialty steps render — see `usePersonaVocab`.
 *
 * UI copy (label/tagline/name placeholder) lives in the `agents` i18n
 * namespace under `create.presets.<id>.*`, as do localized
 * description/instructions seeds — the wizard prefills the editable
 * fields from those keys with the server's canonical English as the
 * `defaultValue` fallback (see docs/reference/localization.md,
 * "Canonical value vs. display").
 *
 * Google-backed presets don't need anything special ON the agent — the
 * Google tools resolve the OWNER's credential at call time — so
 * `requiresGoogle` only drives the post-create "connect Google" pane.
 */
export interface AgentPreset {
  id: "assistant" | "email" | "calendar" | "research";
  labelKey: string;
  taglineKey: string;
  namePlaceholderKey: string;
  role: AgentType;
  /** One of the server's tone keys (`PersonaVocab.tones`). */
  tone: string;
  /** Default model (claude_cli catalog id) — applied on preset pick, still
   *  changeable on the brain step. Absent → the wizard's scratch default. */
  model?: string;
  /** Mixed list — entries found in the role's `specialtiesByRole` options
   *  land in `specialties`, the rest in `customSpecialties`. */
  specialties: string[];
  description: string;
  instructions: string;
  requiresGoogle?: boolean;
  /** Platform integration tools (agent_tools rows, matched by name) to
   *  assign to the agent right after creation. Integration tools are
   *  scope "agent" — WITHOUT an assignment they never appear in the
   *  agent's tool list, no matter what the soul says or whether the
   *  owner connected the provider. */
  tools?: string[];
}

/** Raw wire shape from `GET /api/agents/presets` — camelCase, config only.
 *  UI key names are derived client-side from `id`. */
interface PresetWire {
  id: AgentPreset["id"];
  role: AgentType;
  tone: string;
  model?: string | null;
  specialties: string[];
  description: string;
  instructions: string;
  requiresGoogle: boolean;
  tools: string[];
}

function fromWire(p: PresetWire): AgentPreset {
  return {
    id: p.id,
    labelKey: `create.presets.${p.id}.label`,
    taglineKey: `create.presets.${p.id}.tagline`,
    namePlaceholderKey: `create.presets.${p.id}.namePlaceholder`,
    role: p.role,
    tone: p.tone,
    model: p.model ?? undefined,
    specialties: p.specialties,
    description: p.description,
    instructions: p.instructions,
    requiresGoogle: p.requiresGoogle,
    tools: p.tools,
  };
}

interface Catalog {
  presets: AgentPreset[];
  vocab: PersonaVocab;
}

let cache: Catalog | null = null;
let pending: Promise<Catalog> | null = null;

function getCatalog(): Promise<Catalog> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;

  pending = request<{
    presets: PresetWire[];
    tones: string[];
    specialtiesByRole: PersonaVocab["specialtiesByRole"];
  }>("/api/agents/presets")
    .then((res) => {
      cache = {
        presets: res.presets.map(fromWire),
        vocab: { tones: res.tones, specialtiesByRole: res.specialtiesByRole },
      };
      return cache;
    })
    .catch(() => {
      // No offline fallback: the presets are optional scaffolding for the
      // wizard, and the "Start from scratch" path always works. An empty
      // catalog simply hides the preset cards; an empty vocabulary leaves
      // only the custom tone/specialty inputs.
      cache = { presets: [], vocab: EMPTY_VOCAB };
      return cache;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export async function getAgentPresets(): Promise<AgentPreset[]> {
  return (await getCatalog()).presets;
}

export function resetAgentPresetsCache(): void {
  cache = null;
  pending = null;
}

function useCatalog(): Catalog | null {
  const [catalog, setCatalog] = useState<Catalog | null>(cache);

  useEffect(() => {
    if (cache) {
      if (cache !== catalog) setCatalog(cache);
      return;
    }
    getCatalog().then(setCatalog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return catalog;
}

const NO_PRESETS: AgentPreset[] = [];

export function useAgentPresets(): AgentPreset[] {
  return useCatalog()?.presets ?? NO_PRESETS;
}

/** Tone keys + per-role specialty options from the server's soul builder. */
export function usePersonaVocab(): PersonaVocab {
  return useCatalog()?.vocab ?? EMPTY_VOCAB;
}
