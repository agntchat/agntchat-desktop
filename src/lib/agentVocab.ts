// Desktop's `Agent.agentType` is just `string`. Pin to the canonical
// changeset values here so the persona vocabulary is keyed on the same set
// as web/mobile.
export type AgentType = "worker" | "orchestrator" | "reviewer" | "observer";

/**
 * Persona vocabulary for the Create Agent wizard — tone keys and per-role
 * specialty options. Served by `GET /api/agents/presets` (`tones`,
 * `specialtiesByRole`) from the backend's `Agentchat.Accounts.SoulBuilder`,
 * the ONLY soul builder: the wizard never composes soul.md itself, it sends
 * a `persona` to `POST /api/agents` and the server builds the soul and
 * derives `capabilities` from the specialties.
 */
export interface PersonaVocab {
  tones: string[];
  specialtiesByRole: Partial<Record<AgentType, string[]>>;
}

export const EMPTY_VOCAB: PersonaVocab = { tones: [], specialtiesByRole: {} };

/** Wire shape of `POST /api/agents` `persona` — the wizard's raw choices. */
export interface AgentPersona {
  tone: string | null;
  customTone: string | null;
  specialties: string[];
  description: string;
  instructions: string;
}

/** Maps a canonical specialty option ("QA & Testing") to its i18n key slug
 *  ("qaTesting") under create.specialtyOptions.*. Display-only — the
 *  canonical English value is what's sent to the server. */
export function specialtySlug(value: string): string {
  const words = value.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/);
  return words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}
