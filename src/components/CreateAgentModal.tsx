import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavStore } from "../stores/navStore";
import { useTranslation } from "react-i18next";
import {
  X,
  Camera,
  Plus,
  Loader2,
  MapPin,
  ShieldOff,
  Check,
  ChevronDown,
  ChevronRight,
  Wand2,
  Eye,
  EyeOff,
  Monitor,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { useAgentStore } from "../stores/agentStore";
import { useAuthStore } from "../stores/authStore";
import { useActiveWorkspace, useWorkspacesEnabled } from "../stores/workspaceStore";
import {
  updateAgentRuntime,
  authorizeProvider,
  getProviderStatus,
  listToolCatalog,
  assignToolToAgent,
  draftAgent,
  type AgentDraft,
  type PlatformToolSummary,
} from "../lib/api";
import { openExternal } from "../lib/openExternal";
import { useAgentPresets, usePersonaVocab, type AgentPreset } from "../lib/agentPresets";
import { groupIntegrationTools, anyGoogleTool } from "../lib/toolGroups";
import { useLlmKeyStore } from "../stores/llmKeyStore";
import { splitModels, useModelCatalog, type CatalogModel } from "../stores/modelCatalogStore";
import { useAgentTypes } from "../lib/agentTypes";
import { useFieldLimits } from "../lib/fieldLimits";
import { uploadProcessedBlob } from "../lib/imageProcessor";
import { EXECUTION_MODES, EFFORT_LEVELS } from "../lib/models";
import { specialtySlug, type AgentType } from "../lib/agentVocab";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarCropDialog } from "./AvatarCropDialog";
import { VisibilityField } from "./VisibilityField";
import { BotMascot } from "./onboarding/BotMascot";
import { AmbientParticles } from "./onboarding/AmbientParticles";

// How the fields got filled — sent along as analytics. "quick" = the server
// drafted them from a brief, "preset" = a template seeded them, "advanced"
// = typed by hand. Whichever happened LAST wins; edits after a draft or
// template don't demote it.
type CreationPath = "quick" | "preset" | "advanced";

// Display names for credentialed providers on the integrations' Connect
// buttons (provider ids are lowercase machine keys).
const PROVIDER_LABELS: Record<"google" | "github" | "x", string> = {
  google: "Google",
  github: "GitHub",
  x: "X",
};

const INSTRUCTIONS_MAX = 2000;

// Sentinel values for the single-choice dropdowns.
const NO_TEMPLATE = "__none__";
const CUSTOM_TONE = "__custom__";
// The model dropdown carries provider + model in one value so a single
// pick switches both.
const brainValue = (backend: string, model: string) => `${backend}::${model}`;

/**
 * Create Agent — one form, one screen.
 *
 * The dialog is built to be scanned top to bottom: name and template, a
 * brief the server can draft the rest from, then a grid of dropdowns (role,
 * tone, specialties, where it runs, model) and a description. Everything
 * else — instructions, location, integrations, execution knobs, API key,
 * safety switches, workspace visibility — lives behind one collapsed "More
 * options" section. Only the name is required.
 */
export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation("agents");
  const { createAgent, selectAgent } = useAgentStore();
  const limits = useFieldLimits();

  const llmKeyStore = useLlmKeyStore();
  const llmKeysLoaded = useLlmKeyStore((s) => s.loaded);
  const refreshLlmKeys = useLlmKeyStore((s) => s.refresh);
  useEffect(() => {
    if (!llmKeysLoaded) refreshLlmKeys();
  }, [llmKeysLoaded, refreshLlmKeys]);

  const catalog = useModelCatalog();
  // Keyed on the (stable) action, not the store object: a failed load
  // flips `loading` and would otherwise re-trigger this effect forever.
  const ensureCatalog = useModelCatalog((s) => s.ensureLoaded);
  useEffect(() => {
    void ensureCatalog();
  }, [ensureCatalog]);
  const PROVIDERS = catalog.providers;

  const agentTypes = useAgentTypes();
  const agentPresets = useAgentPresets();
  const { tones, specialtiesByRole } = usePersonaVocab();

  // ---- Fill source ----
  const [preset, setPreset] = useState<AgentPreset | null>(null);
  // brief — free text sent to POST /api/agents/draft; the proposal fills the
  // fields below. Also stored on the agent (metadata.creation_brief) so its
  // first greeting can play the brief back and invite corrections.
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [creationPath, setCreationPath] = useState<CreationPath>("advanced");
  // Owner's Google connection, prefetched so the create path doesn't await
  // it. null = unknown.
  const googleConnectedRef = useRef<boolean | null>(null);
  // After creating a Google-backed agent without a connection, the modal
  // flips to a connect pane instead of closing.
  const [phase, setPhase] = useState<"form" | "connect">("form");
  const [connectStatus, setConnectStatus] = useState<
    "idle" | "waiting" | "connected"
  >("idle");
  const connectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (connectPollRef.current) clearInterval(connectPollRef.current);
    },
    []
  );

  // ---- Identity ----
  const [displayName, setDisplayName] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [agentRole, setAgentRole] = useState<AgentType>("worker");

  // ---- Personality ----
  const [tone, setTone] = useState<string | null>(null);
  // customTone is non-null while "Custom" is the chosen tone (empty string
  // = the input is showing but nothing typed yet).
  const [customTone, setCustomTone] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [customSpecialties, setCustomSpecialties] = useState<string[]>([]);
  const [customSpecialtyInput, setCustomSpecialtyInput] = useState("");
  const [specialtyAddOpen, setSpecialtyAddOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [requiresLocation, setRequiresLocation] = useState(false);

  // ---- More options ----
  // Page 1: the essentials. Page 2: advanced settings, always visited on
  // the way to Create so nothing is missed.
  const [page, setPage] = useState<1 | 2>(1);
  const formRef = useRef<HTMLFormElement | null>(null);

  // ---- Integrations — tools (scope "agent") to assign after creation.
  // Pre-seeded by templates/drafts; the picker fetches the catalog on mount.
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  // Explicit "none needed" — counts the Integrations section as decided so
  // an agent without tools can still reach 100%.
  const [noIntegrations, setNoIntegrations] = useState(false);
  const [toolCatalog, setToolCatalog] = useState<PlatformToolSummary[]>([]);
  // Provider groups start collapsed; the header switch toggles the whole
  // group, the chevron reveals individual tools.
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(
    new Set()
  );
  // Connection status per credentialed provider, shown on the group headers
  // so users can connect right here instead of after creation. undefined =
  // unknown (no badge).
  const [wizardConnections, setWizardConnections] = useState<
    Record<string, boolean | undefined>
  >({});
  useEffect(() => {
    for (const provider of ["google", "github", "x"] as const) {
      getProviderStatus(provider)
        .then((s) => {
          setWizardConnections((prev) => ({ ...prev, [provider]: s.connected }));
          if (provider === "google") googleConnectedRef.current = s.connected;
        })
        .catch(() => {
          // stays unknown
        });
    }
  }, []);
  const wizardConnPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
    },
    []
  );

  // Launch OAuth in the system browser and poll until the credential lands
  // (same mechanics as the post-create connect pane — there's no in-app
  // completion event).
  const handleWizardConnect = async (provider: "google" | "github" | "x") => {
    // X needs its Connected Accounts setup form (own app credentials).
    if (provider === "x") {
      useNavStore.getState().openProfile();
      return;
    }
    try {
      const { authorizeUrl } = await authorizeProvider(provider);
      openExternal(authorizeUrl);
      const startedAt = Date.now();
      if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
      wizardConnPollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 120_000) {
          if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
          wizardConnPollRef.current = null;
          return;
        }
        try {
          const s = await getProviderStatus(provider);
          if (s.connected) {
            if (wizardConnPollRef.current) clearInterval(wizardConnPollRef.current);
            wizardConnPollRef.current = null;
            setWizardConnections((prev) => ({ ...prev, [provider]: true }));
            if (provider === "google") googleConnectedRef.current = true;
          }
        } catch {
          // transient — keep polling
        }
      }, 3000);
    } catch {
      // authorize failed — badge stays; user can retry
    }
  };
  useEffect(() => {
    listToolCatalog()
      .then(setToolCatalog)
      .catch(() => {
        // picker shows an empty state; template assignment still works by name
      });
  }, []);

  // ---- Visibility: null = all workspaces (organizationIds omitted, the
  // default), otherwise the workspace ids to pin the new agent to.
  const [visibilityOrgIds, setVisibilityOrgIds] = useState<string[] | null>(null);
  const activeWorkspace = useActiveWorkspace();

  // ---- Brain — backend / model / execution mode / effort / key / safety
  const [backend, setBackend] = useState("claude_cli");
  const [model, setModel] = useState("");
  const [executionMode, setExecutionMode] = useState("tool_use");
  const [effort, setEffort] = useState<string | null>(null);
  // Default ON: agents run unattended, and permission prompts stall them
  // waiting for an operator. Skip-permissions is server-owned and only
  // applies to the CLI backends (claude_cli/codex_cli); the switch is
  // hidden for API backends, so this default is inert there.
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [computerUseEnabled, setComputerUseEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  // Three-way: "__default__" = use provider default (no llmApiKeyId on
  // the agent), "__custom__" = a brand-new key entered below + saved
  // for this agent only, "<existing-id>" = pin to a saved non-default
  // key. Reset to "__default__" whenever the backend flips.
  const [keySelection, setKeySelection] = useState<string>("__default__");

  // Hosting — for plan users we default new agents to "hosted" (always-on,
  // runs on their host using the plan's shared brain) so they can create and
  // start talking with zero setup. Advanced users switch to "local".
  const participant = useAuthStore((s) => s.participant);
  const workspacesEnabled = useWorkspacesEnabled();
  const subStatus = participant?.subscription?.status;
  const isPlan = subStatus === "active" || subStatus === "trialing";
  const hostedHostId = participant?.hostedHostId ?? null;
  // Hosted runtime is behind the `org_hosts` flag. When off, no hosted option
  // is offered at creation and new agents run locally.
  const orgHostsEnabled = participant?.features?.org_hosts === true;
  const canHost = orgHostsEnabled && isPlan && !!hostedHostId;
  const [hosting, setHosting] = useState<"hosted" | "local">(
    canHost ? "hosted" : "local"
  );
  const hosted = hosting === "hosted" && canHost;
  // What the TARGET MACHINE can actually run. A host declares the backend it
  // serves in its heartbeat (`/me` → hostedHostRuntime); assume the universal
  // Claude seat when it predates that reporting. A local machine can run any
  // CLI backend (presence isn't detectable from here) and any API backend,
  // since the key field below can supply one.
  //
  // Blocked providers stay LISTED but disabled, with the reason — so the
  // choice is visible without being a trap.
  const hostRuntime = participant?.hostedHostRuntime ?? null;
  const providerBlock = useCallback(
    (providerId: string): "notOnHost" | null => {
      if (!hosted) return null;
      return providerId === (hostRuntime?.backend ?? "claude_cli") ? null : "notOnHost";
    },
    [hosted, hostRuntime]
  );
  const availableProviders = useMemo(
    () => PROVIDERS.filter((p) => providerBlock(p.id) === null),
    [PROVIDERS, providerBlock]
  );

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default model for a provider: Opus 4.8 when the catalog has it (the
  // scratch default), else the catalog's first entry. Templates override
  // this with their own model in applyPreset.
  const defaultModelFor = useCallback(
    (backendId: string) => {
      const list = catalog.modelsFor(backendId);
      return (
        list.find((m) => m.id === "claude-opus-4-8")?.id ?? list[0]?.id ?? ""
      );
    },
    [catalog]
  );

  // Once the catalog resolves, default backend/model to the first option if
  // the current backend isn't actually available. Keeps the initial
  // "claude_cli" guess if it IS in the catalog.
  useEffect(() => {
    if (availableProviders.length === 0) return;
    if (availableProviders.some((p) => p.id === backend)) {
      if (!model) {
        setModel(defaultModelFor(backend));
      }
      return;
    }
    const first = availableProviders[0];
    if (!first) return;
    setBackend(first.id);
    setModel(defaultModelFor(first.id));
  }, [availableProviders, backend, model, catalog, defaultModelFor]);

  const models = useMemo(
    () => (backend ? catalog.modelsFor(backend) : []),
    [catalog, backend]
  );
  const supportedModes = useMemo(
    () => (backend ? catalog.supportedModesFor(backend) : []),
    [catalog, backend]
  );
  const needsApiKey = backend ? catalog.requiresLlmKey(backend) : false;
  const hasDefaultKey = useMemo(
    () => llmKeyStore.getDefaultKey(backend) !== null,
    [llmKeyStore, backend]
  );
  const providerKeys = useMemo(
    () => llmKeyStore.getKeysForProvider(backend),
    [llmKeyStore, backend]
  );
  // Show the raw API-key input either:
  //   - the user has no default for this provider (the entered key BECOMES the default), or
  //   - they explicitly chose "Custom Key for this agent" from the picker.
  const showApiKeyInput =
    needsApiKey && (!hasDefaultKey || keySelection === "__custom__");
  const showEffort = backend === "claude_cli";

  const handleBackendChange = (next: string) => {
    if (!next) return;
    setBackend(next);
    setModel(defaultModelFor(next));
    const newModes = catalog.supportedModesFor(next);
    if (!newModes.includes(executionMode)) {
      setExecutionMode(newModes.includes("tool_use") ? "tool_use" : newModes[0] ?? "");
    }
    if (next !== "claude_cli") {
      setEffort(null);
    }
    setApiKey("");
    setKeySelection("__default__");
  };

  // One dropdown for provider + model: "<backend>::<model>".
  const handleBrainChange = (value: string | null) => {
    if (!value) return;
    const sep = value.indexOf("::");
    if (sep < 0) return;
    const nextBackend = value.slice(0, sep);
    const nextModel = value.slice(sep + 2);
    if (nextBackend !== backend) handleBackendChange(nextBackend);
    setModel(nextModel);
  };

  const specialtyOptions = specialtiesByRole[agentRole] ?? [];

  // Only some specialties have a tailored placeholder in the catalog, so the
  // first one that does wins and the rest fall back to the role's "default".
  const descPlaceholder = useMemo(() => {
    const match = specialties.find((s) =>
      i18n.exists(`agents:create.descPlaceholders.${agentRole}.${specialtySlug(s)}`)
    );
    const suffix = match ? specialtySlug(match) : "default";
    return t(`create.descPlaceholders.${agentRole}.${suffix}`);
  }, [agentRole, specialties, t, i18n]);

  // Split a mixed specialty list into the role's catalog options and the
  // custom remainder — the two are separate state (dropdown vs. chips).
  const seedSpecialties = (role: AgentType, list: string[]) => {
    const options = specialtiesByRole[role] ?? [];
    setSpecialties(list.filter((s) => options.includes(s)));
    setCustomSpecialties(list.filter((s) => !options.includes(s)));
  };

  const prefetchGoogle = () => {
    if (googleConnectedRef.current !== null) return;
    void getProviderStatus("google")
      .then((s) => {
        googleConnectedRef.current = s.connected;
      })
      .catch(() => {
        // stays null — re-checked at create time
      });
  };

  // Draft: fill every field from the server's proposal. A name the user
  // already typed is sent along and comes back unchanged.
  const applyDraft = (d: AgentDraft) => {
    setPreset(null);
    setCreationPath("quick");
    if (d.displayName) setDisplayName(d.displayName);
    const role = (agentTypes.some((x) => x.id === d.agentType)
      ? d.agentType
      : "worker") as AgentType;
    setAgentRole(role);
    seedSpecialties(role, d.specialties);
    const toneKey = d.tone && tones.includes(d.tone) ? d.tone : null;
    setTone(toneKey);
    setCustomTone(toneKey ? null : d.customTone);
    setDescription(d.description);
    setCustomInstructions(d.instructions);
    setSelectedTools(d.tools);
    setRequiresLocation(d.requiresLocation);
    if (d.requiresGoogle) prefetchGoogle();
    setDrafted(true);
  };

  const handleDraft = async () => {
    const text = brief.trim();
    if (!text || drafting) return;
    setDrafting(true);
    setDraftError(null);
    setDrafted(false);
    try {
      applyDraft(await draftAgent(text, displayName.trim() || undefined));
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      setDraftError(
        status === 503 ? t("create.brief.unavailable") : t("create.brief.failed")
      );
    } finally {
      setDrafting(false);
    }
  };

  // Template: seed role/tone/specialties/description/instructions/tools.
  // The name is left alone (the placeholder hints at one). Sets role FIRST
  // and then specialties in the same handler — the role dropdown's own
  // change handler resets specialties, but this path bypasses it
  // deliberately.
  const applyPreset = (p: AgentPreset) => {
    setPreset(p);
    setDraftError(null);
    setDrafted(false);
    setCreationPath("preset");
    setAgentRole(p.role);
    seedSpecialties(p.role, p.specialties);
    setTone(p.tone);
    setCustomTone(null);
    // Prefill in the user's language — the server preset carries English
    // canonical text as the fallback. Both fields stay fully editable, so
    // whatever the user keeps (or rewrites) is what lands on the agent.
    setDescription(
      t(`create.presets.${p.id}.description`, { defaultValue: p.description })
    );
    setCustomInstructions(
      t(`create.presets.${p.id}.instructions`, { defaultValue: p.instructions })
    );
    setSelectedTools(p.tools ?? []);
    // Template default model (only meaningful on the claude_cli backend the
    // form starts on; a later provider switch re-defaults it anyway).
    if (p.model && backend === "claude_cli") setModel(p.model);
    if (p.requiresGoogle) prefetchGoogle();
    if (!displayName.trim()) nameInputRef.current?.focus();
  };

  const handleTemplateChange = (value: string | null) => {
    if (!value || value === NO_TEMPLATE) {
      setPreset(null);
      return;
    }
    const p = agentPresets.find((x) => x.id === value);
    if (p) applyPreset(p);
  };

  const handleToneChange = (value: string | null) => {
    if (!value) return;
    if (value === CUSTOM_TONE) {
      setTone(null);
      setCustomTone((prev) => prev ?? "");
      return;
    }
    setTone(value);
    setCustomTone(null);
  };

  const handleAvatarPick = () => fileInputRef.current?.click();

  const handleAvatarFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    // Hand the raw file to the crop dialog rather than uploading it — the
    // upload only happens once the user has framed the shot.
    setCropImageSrc(URL.createObjectURL(file));
  };

  const closeCrop = () => {
    setCropImageSrc((src) => {
      if (src) URL.revokeObjectURL(src);
      return null;
    });
  };

  const handleCropConfirm = async (blob: Blob) => {
    closeCrop();
    setUploadingAvatar(true);
    setError(null);
    try {
      const url = await uploadProcessedBlob(
        blob,
        blob.type || "image/jpeg",
        `avatars/pending-${Date.now()}`
      );
      setAvatarUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("create.errors.uploadFailed"));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const addCustomSpecialty = () => {
    const v = customSpecialtyInput.trim();
    if (!v) {
      setSpecialtyAddOpen(false);
      return;
    }
    if (
      [...specialties, ...customSpecialties].some(
        (x) => x.toLowerCase() === v.toLowerCase()
      )
    ) {
      setCustomSpecialtyInput("");
      setSpecialtyAddOpen(false);
      return;
    }
    setCustomSpecialties((prev) => [...prev, v]);
    setCustomSpecialtyInput("");
    setSpecialtyAddOpen(false);
  };

  const removeCustomSpecialty = (s: string) => {
    setCustomSpecialties((prev) => prev.filter((x) => x !== s));
  };

  const handleCreate = useCallback(async () => {
    if (!displayName.trim()) {
      setError(t("create.errors.nameRequired"));
      nameInputRef.current?.focus();
      return;
    }
    // Hosted agents use the host's shared brain — no API key to enter.
    if (hosting === "local" && showApiKeyInput && !apiKey.trim()) {
      setError(t("create.errors.apiKeyRequired"));
      setPage(2);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // Hosted agents run on the org host with its shared Claude seat, so we
      // pin sensible defaults (claude_cli) and skip per-agent key handling.
      // canHost guard: users without the hosted runtime can never create
      // hosted (the dropdown disables it, this backstops it).
      const effBackend = backend;
      const effModel = model;
      const effExecutionMode = hosted ? "tool_use" : executionMode;

      // Resolve the key choice:
      //   * No default exists + key entered → save it AS the default.
      //   * Default exists + custom key entered → save as a non-default
      //     credential and pin this agent to it via llmApiKeyId.
      //   * "__default__" → use the provider default (no pin).
      //   * "<id>" → pin to an existing saved key.
      let llmApiKeyIdPin: string | null = null;
      if (!hosted) {
        if (apiKey.trim() && needsApiKey) {
          const provider = PROVIDERS.find((p) => p.id === backend);
          const label = `${provider?.label || backend} Key`;
          try {
            const newId = await llmKeyStore.addKey(backend, label, apiKey.trim(), {
              makeDefault: !hasDefaultKey,
            });
            if (hasDefaultKey) llmApiKeyIdPin = newId;
          } catch (e) {
            setError(e instanceof Error ? e.message : t("create.errors.saveKeyFailed"));
            setCreating(false);
            return;
          }
        } else if (
          keySelection !== "__default__" &&
          keySelection !== "__custom__"
        ) {
          // User picked an existing non-default saved key — pin to it.
          llmApiKeyIdPin = keySelection;
        }
      }

      // The server composes soul.md from these and derives `capabilities`
      // from the specialties (Agentchat.Accounts.SoulBuilder).
      const persona = {
        tone,
        customTone: customTone?.trim() || null,
        specialties: [...specialties, ...customSpecialties],
        description,
        instructions: customInstructions,
      };

      // Cross-device fields live in agent.metadata (snake_case, backend-
      // merged). computer_use_enabled follows the agent across desktops; the
      // creation brief lets the first-run greeting play the owner's own
      // words back (FirstAgentGreetingWorker).
      const metadata: Record<string, unknown> = {
        ...(!hosted && computerUseEnabled ? { computer_use_enabled: true } : {}),
        ...(creationPath === "quick" && brief.trim()
          ? { creation_brief: brief.trim() }
          : {}),
      };

      const newId = await createAgent({
        displayName: displayName.trim(),
        agentType: agentRole,
        creationPath,
        // Local choice must be explicit — without it the backend auto-places
        // every new agent on the owner's org host when one exists.
        ...(!hosted ? { runtime: "local" as const } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(requiresLocation ? { requiresLocation: true } : {}),
        persona,
        ...(effBackend ? { backend: effBackend } : {}),
        ...(effModel ? { model: effModel } : {}),
        ...(effExecutionMode ? { executionMode: effExecutionMode } : {}),
        // Local-only brain knobs — hosted agents use the host's shared seat.
        ...(!hosted && effort ? { effort } : {}),
        ...(!hosted && skipPermissions ? { dangerouslySkipPermissions: true } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        ...(llmApiKeyIdPin ? { llmApiKeyId: llmApiKeyIdPin } : {}),
        // Visibility: omit organizationIds (= all-workspaces default)
        // unless the user picked a pin set — any workspaces they belong
        // to, Personal included.
        ...(visibilityOrgIds && visibilityOrgIds.length > 0
          ? { organizationIds: visibilityOrgIds }
          : {}),
      });

      // Hosted: dedicate the agent to the user's host so it's always on.
      // Non-fatal — if it fails the agent still exists (just local for now).
      if (newId && hosted && hostedHostId) {
        try {
          await updateAgentRuntime(newId, {
            runtime: "org_host",
            organizationId: participant?.organizationId ?? activeWorkspace?.id ?? null,
            assignedHostId: hostedHostId,
            presenceMode: "always_on",
          });
        } catch {
          // leave as local; user can fix in the agent's Runtime settings
        }
      }

      // Selected integration tools: platform tools like Gmail/Calendar are
      // scope "agent" — they never appear in the agent's tool list without
      // an explicit assignment, regardless of the soul or the owner's
      // Google connection. Best-effort: a failed assignment shouldn't fail
      // the create (tools can be assigned later in the agent's Tools tab).
      if (newId && selectedTools.length > 0) {
        try {
          const catalogTools =
            toolCatalog.length > 0 ? toolCatalog : await listToolCatalog();
          const byName = new Map(catalogTools.map((tl) => [tl.name, tl.id]));
          await Promise.all(
            selectedTools.map((name) => {
              const toolId = byName.get(name);
              return toolId
                ? assignToolToAgent(toolId, newId).catch(() => undefined)
                : Promise.resolve(undefined);
            })
          );
        } catch {
          // catalog fetch failed — non-fatal
        }
      }

      if (newId) await selectAgent(newId);

      // Google-backed selection: if the owner hasn't connected Google, keep
      // the modal open on a connect pane instead of closing — the agent
      // exists either way, but its tools only work once connected. Covers
      // templates AND hand-built agents that picked Google tools.
      const wantsGoogle =
        preset?.requiresGoogle || anyGoogleTool(toolCatalog, selectedTools);

      if (newId && wantsGoogle) {
        let connected = googleConnectedRef.current;
        if (connected === null) {
          try {
            connected = (await getProviderStatus("google")).connected;
          } catch {
            connected = false;
          }
        }
        if (!connected) {
          setPhase("connect");
          return;
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("create.errors.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [
    preset,
    selectedTools,
    toolCatalog,
    displayName,
    tone,
    customTone,
    description,
    specialties,
    customSpecialties,
    customInstructions,
    requiresLocation,
    avatarUrl,
    agentRole,
    backend,
    model,
    executionMode,
    effort,
    skipPermissions,
    computerUseEnabled,
    apiKey,
    keySelection,
    hasDefaultKey,
    needsApiKey,
    showApiKeyInput,
    PROVIDERS,
    llmKeyStore,
    createAgent,
    selectAgent,
    onClose,
    hosting,
    hosted,
    hostedHostId,
    participant,
    catalog,
    activeWorkspace,
    visibilityOrgIds,
    creationPath,
    brief,
    canHost,
    t,
  ]);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const providerLabel = PROVIDERS.find((p) => p.id === backend)?.label;
  const specialtyLabel = (s: string) =>
    t(`create.specialtyOptions.${specialtySlug(s)}`, { defaultValue: s });
  const toneSelectValue = tone ?? (customTone !== null ? CUSTOM_TONE : "");
  const goToPage = (next: 1 | 2) => {
    if (next === 2 && !displayName.trim()) {
      setError(t("create.errors.nameRequired"));
      nameInputRef.current?.focus();
      return;
    }
    setError(null);
    setPage(next);
    formRef.current?.scrollTo({ top: 0 });
  };

  const canCreate =
    displayName.trim().length > 0 && !creating && PROVIDERS.length > 0;

  // Completeness meter — LinkedIn-style nudge to keep filling the agent in.
  // Weights sum to 100. Defaults that are always set (role, runtime, model)
  // don't score; only things the user actively adds do. The nudge names the
  // single highest-value item still missing.
  const completeness = useMemo(() => {
    type Cat = "identity" | "personality" | "details" | "integrations";
    const items: { key: string; cat: Cat; points: number; done: boolean }[] = [
      { key: "name", cat: "identity", points: 15, done: displayName.trim().length > 0 },
      { key: "photo", cat: "identity", points: 10, done: !!avatarUrl },
      { key: "brief", cat: "identity", points: 10, done: brief.trim().length > 0 },
      { key: "tone", cat: "personality", points: 10, done: !!tone || !!customTone?.trim() },
      {
        key: "specialties",
        cat: "personality",
        points: 15,
        done: specialties.length + customSpecialties.length > 0,
      },
      { key: "description", cat: "personality", points: 10, done: description.trim().length > 0 },
      { key: "instructions", cat: "details", points: 15, done: customInstructions.trim().length > 0 },
      {
        key: "integrations",
        cat: "integrations",
        points: 15,
        done: selectedTools.length > 0 || noIntegrations,
      },
    ];
    const percent = items.reduce((sum, i) => sum + (i.done ? i.points : 0), 0);
    const next = items
      .filter((i) => !i.done)
      .sort((a, b) => b.points - a.points)[0];
    // Page order: identity, personality (page 1) → details, integrations
    // (page 2). `weight` is the category's share of the 100 points; `percent`
    // is how much of that share is earned.
    const categories = (["identity", "personality", "details", "integrations"] as Cat[]).map(
      (cat) => {
        const own = items.filter((i) => i.cat === cat);
        const weight = own.reduce((sum, i) => sum + i.points, 0);
        const earned = own.reduce((sum, i) => sum + (i.done ? i.points : 0), 0);
        return { cat, weight, percent: Math.round((earned / weight) * 100) };
      }
    );
    const byCat = Object.fromEntries(categories.map((c) => [c.cat, c.percent])) as Record<
      Cat,
      number
    >;
    return { percent, next, categories, byCat };
  }, [
    displayName,
    avatarUrl,
    brief,
    tone,
    customTone,
    specialties,
    customSpecialties,
    description,
    customInstructions,
    selectedTools,
    noIntegrations,
  ]);

  // A score increase fires a one-shot flash (a sweep across the bar and a
  // bump on the number), keyed so back-to-back gains restart it. Decreases
  // are quiet.
  const [burst, setBurst] = useState<{ id: number } | null>(null);
  const prevPercentRef = useRef(completeness.percent);
  useEffect(() => {
    const prev = prevPercentRef.current;
    prevPercentRef.current = completeness.percent;
    if (completeness.percent <= prev) return;
    setBurst({ id: Date.now() });
    const timer = setTimeout(() => setBurst(null), 800);
    return () => clearTimeout(timer);
  }, [completeness.percent]);

  // Launch the Google OAuth in the system browser and poll for the
  // credential landing (the callback is handled server-side; there's no
  // in-app completion event).
  const handleConnectGoogle = async () => {
    setError(null);
    try {
      const { authorizeUrl } = await authorizeProvider("google");
      openExternal(authorizeUrl);
      setConnectStatus("waiting");
      const startedAt = Date.now();
      if (connectPollRef.current) clearInterval(connectPollRef.current);
      connectPollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 120_000) {
          if (connectPollRef.current) clearInterval(connectPollRef.current);
          connectPollRef.current = null;
          setConnectStatus("idle");
          return;
        }
        try {
          const s = await getProviderStatus("google");
          if (s.connected) {
            if (connectPollRef.current) clearInterval(connectPollRef.current);
            connectPollRef.current = null;
            setConnectStatus("connected");
          }
        } catch {
          // transient — keep polling
        }
      }, 3000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("create.errors.createFailed")
      );
    }
  };

  if (phase === "connect") {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden">
          <div className="relative">
            <AmbientParticles count={14} />
            <div className="relative px-6 pt-7 pb-6 flex flex-col items-center text-center gap-3">
              <BotMascot size={64} />
              <DialogTitle className="text-lg font-semibold text-foreground">
                {t("create.connect.title", { name: displayName.trim() })}
              </DialogTitle>
              <p className="text-sm text-text-muted max-w-sm">
                {t("create.connect.body", { name: displayName.trim() })}
              </p>
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-2 flex flex-col items-center gap-2">
                {connectStatus === "connected" ? (
                  <>
                    <span className="flex items-center gap-1.5 text-sm text-success">
                      <Check className="h-4 w-4" />
                      {t("create.connect.connected")}
                    </span>
                    <Button type="button" onClick={onClose}>
                      {t("create.connect.done")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      onClick={() => void handleConnectGoogle()}
                      disabled={connectStatus === "waiting"}
                    >
                      {connectStatus === "waiting" ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          {t("create.connect.waiting")}
                        </>
                      ) : (
                        t("create.connect.cta")
                      )}
                    </Button>
                    <Button type="button" variant="ghost" onClick={onClose}>
                      {t("create.connect.skip")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[860px] p-0 gap-0 overflow-hidden">
        <div className="relative flex max-h-[88vh] flex-col">
          <AmbientParticles count={10} />

          {/* Header */}
          <div className="relative flex items-center gap-3 px-6 pt-5 pb-3">
            <BotMascot size={44} />
            <div className="min-w-0 space-y-0.5">
              <DialogTitle className="text-base font-semibold text-foreground">
                {t("create.dialogTitle")}
              </DialogTitle>
              {page === 2 && (
                <p className="text-xs text-text-muted">{t("create.moreOptionsHint")}</p>
              )}
            </div>
            <div className="ml-auto flex shrink-0 flex-col items-end gap-1 pr-8">
              <div
                className="flex items-center gap-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={completeness.percent}
                aria-label={t("create.completeness.label", { percent: completeness.percent })}
              >
                {/* One segment per category, sized by its share of the
                    points and filled by how much of that share is earned. */}
                <div className="relative flex h-1.5 w-48 gap-0.5 overflow-hidden rounded-full">
                  {completeness.categories.map((c) => (
                    <div
                      key={c.cat}
                      className="h-full overflow-hidden rounded-full bg-border"
                      style={{ flex: c.weight }}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500 ease-out",
                          completeness.percent === 100 ? "bg-warning" : "bg-primary"
                        )}
                        style={{ width: `${c.percent}%` }}
                      />
                    </div>
                  ))}
                  {/* Idle glint: a slow periodic sheen so the bar keeps
                      catching the eye while there's still room to fill. */}
                  {completeness.percent > 0 && completeness.percent < 100 && (
                    <span className="meter-glint pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
                  )}
                  {burst && (
                    <span
                      key={burst.id}
                      className="meter-sweep absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/90 to-transparent"
                    />
                  )}
                </div>
                <span className="relative inline-flex items-center">
                  <span
                    key={burst?.id ?? "steady"}
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      burst && "meter-bump",
                      completeness.percent === 100 ? "text-warning" : "text-foreground"
                    )}
                  >
                    {t("create.completeness.label", { percent: completeness.percent })}
                  </span>
                </span>
              </div>
              {completeness.next && (
                <span className="text-[11px] text-text-muted">
                  {t("create.completeness.nudge", {
                    action: t(`create.completeness.items.${completeness.next.key}`),
                    points: completeness.next.points,
                  })}
                </span>
              )}
            </div>
          </div>

          {/* Body */}
          <form
            id="create-agent-form"
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              if (page === 1) goToPage(2);
              else void handleCreate();
            }}
            className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-5"
          >
            {/* Page 1 — two columns: who they are (left), how they work (right). */}
            {page === 1 && (
            <div className="grid grid-cols-2 gap-x-6">
              <div className="space-y-5">
                <Category progress={completeness.byCat.identity}>{t("create.sections.identity")}</Category>
                {/* Identity: avatar + name + template */}
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    onClick={handleAvatarPick}
                    className="relative group shrink-0"
                    title={t("create.chooseAvatar")}
                  >
                    <Avatar className="h-[76px] w-[76px] rounded-2xl border-2 border-dashed border-border group-hover:border-primary transition-colors after:hidden">
                      {avatarUrl && (
                        <AvatarImage
                          src={avatarUrl}
                          className="rounded-2xl object-cover"
                        />
                      )}
                      <AvatarFallback className="rounded-2xl bg-primary/5 text-lg font-semibold text-text-muted">
                        {initials || <Camera className="h-5 w-5" />}
                      </AvatarFallback>
                    </Avatar>
                    {uploadingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      </div>
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      handleAvatarFile(e.target.files?.[0]);
                      // Clear the value so picking the same file again after
                      // cancelling the crop still fires onChange.
                      e.target.value = "";
                    }}
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label={`${t("common:name")} ${t("common:requiredHint")}`} htmlFor="agent-name" counter={`${displayName.length}/${limits.agent.displayName}`}>
                      <Input
                        id="agent-name"
                        ref={nameInputRef}
                        type="text"
                        value={displayName}
                        onChange={(e) => {
                          setDisplayName(e.target.value);
                          if (error) setError(null);
                        }}
                        placeholder={
                          preset
                            ? t(preset.namePlaceholderKey)
                            : t("create.namePlaceholder")
                        }
                        autoFocus
                        maxLength={limits.agent.displayName}
                      />
                    </Field>
                    <Field label={t("create.template.label")}>
                      <Select
                        value={preset?.id ?? NO_TEMPLATE}
                        onValueChange={handleTemplateChange}
                        disabled={drafting || agentPresets.length === 0}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(val: unknown) => {
                              const p = agentPresets.find((x) => x.id === String(val));
                              return p ? (
                                t(p.labelKey)
                              ) : (
                                <span className="text-muted-foreground">
                                  {t("create.template.placeholder")}
                                </span>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_TEMPLATE}>{t("create.template.none")}</SelectItem>
                          {agentPresets.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              <span className="flex items-center gap-1.5">
                                {t(p.labelKey)}
                                {p.requiresGoogle && (
                                  <span className="rounded-full bg-muted px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                                    {t("create.presets.googleBadge")}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>

                {/* Brief → draft */}
                <Field label={t("create.brief.title")} htmlFor="agent-brief">
                  <p className="-mt-1 text-[11px] text-text-muted">
                    {t("create.brief.hint")}
                  </p>
                  <Textarea
                    id="agent-brief"
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder={t("create.brief.placeholder")}
                    rows={5}
                    maxLength={limits.agent.creationBrief}
                    disabled={drafting}
                    className="min-h-[120px] resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void handleDraft();
                      }
                    }}
                  />
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-[10px] text-text-muted tabular-nums">
                      {brief.length}/{limits.agent.creationBrief}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={drafted ? "outline" : "default"}
                      onClick={() => void handleDraft()}
                      disabled={drafting || brief.trim().length === 0}
                    >
                      {drafting ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          {t("create.brief.drafting")}
                        </>
                      ) : (
                        <>
                          <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                          {t("create.brief.draftButton")}
                        </>
                      )}
                    </Button>
                  </div>
                  {draftError && (
                    <p className="text-xs text-destructive" role="alert">
                      {draftError}
                    </p>
                  )}
                  {drafted && !draftError && (
                    <p className="flex items-center gap-1 text-xs text-success">
                      <Check className="h-3.5 w-3.5" />
                      {t("create.brief.draftedHint")}
                    </p>
                  )}
                </Field>

              </div>
              <div className="space-y-5 border-l border-border pl-6">
                <Category progress={completeness.byCat.personality}>{t("create.sections.personality")}</Category>
                {/* Role + Tone */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("create.stepLabels.role")}>
                    <Select
                      value={agentRole}
                      onValueChange={(v) => {
                        if (!v || v === agentRole) return;
                        setAgentRole(v as AgentType);
                        setSpecialties([]);
                        setCustomSpecialties([]);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(val: unknown) => {
                            const type = agentTypes.find((x) => x.id === String(val));
                            return type
                              ? t(`roles.${type.id}.label`, { defaultValue: type.label })
                              : String(val ?? "");
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {agentTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            <span className="flex flex-col">
                              <span>{t(`roles.${type.id}.label`, { defaultValue: type.label })}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {t(`roles.${type.id}.desc`, { defaultValue: type.description })}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("create.stepLabels.tone")}>
                    <Select value={toneSelectValue} onValueChange={handleToneChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(val: unknown) => {
                            const v = String(val ?? "");
                            if (!v)
                              return (
                                <span className="text-muted-foreground">
                                  {t("create.tonePlaceholder")}
                                </span>
                              );
                            if (v === CUSTOM_TONE) return t("common:custom");
                            return t(`tones.${v}`);
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {tones.map((toneKey) => (
                          <SelectItem key={toneKey} value={toneKey}>
                            {t(`tones.${toneKey}`)}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_TONE}>{t("common:custom")}…</SelectItem>
                      </SelectContent>
                    </Select>
                    {customTone !== null && (
                      <Input
                        autoFocus
                        value={customTone}
                        onChange={(e) => setCustomTone(e.target.value)}
                        placeholder={t("create.customTonePlaceholder")}
                        maxLength={30}
                        className="h-8 text-xs"
                      />
                    )}
                  </Field>
                </div>

                {/* Specialties (multi-select) */}
                <Field label={t(`create.specialtiesLabel.${agentRole}`)}>
                  <Select
                    multiple
                    value={specialties}
                    onValueChange={(v) => setSpecialties(v ?? [])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(val: unknown) => {
                          const list = Array.isArray(val) ? (val as string[]) : [];
                          return list.length === 0 ? (
                            <span className="text-muted-foreground">
                              {t("create.specialtiesPlaceholder")}
                            </span>
                          ) : (
                            list.map(specialtyLabel).join(", ")
                          );
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {specialtyOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {specialtyLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {customSpecialties.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                      >
                        {specialtyLabel(s)}
                        <button
                          type="button"
                          onClick={() => removeCustomSpecialty(s)}
                          aria-label={t("create.removeSpecialty", { name: s })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {specialtyAddOpen ? (
                      <Input
                        autoFocus
                        value={customSpecialtyInput}
                        onChange={(e) => setCustomSpecialtyInput(e.target.value)}
                        placeholder={t("create.addSpecialtyPlaceholder")}
                        maxLength={40}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCustomSpecialty();
                          }
                          if (e.key === "Escape") {
                            setCustomSpecialtyInput("");
                            setSpecialtyAddOpen(false);
                          }
                        }}
                        onBlur={addCustomSpecialty}
                        className="h-7 w-48 text-xs"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSpecialtyAddOpen(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-text-muted hover:bg-accent"
                      >
                        <Plus className="h-3 w-3" /> {t("common:custom")}
                      </button>
                    )}
                  </div>
                </Field>

                {/* Description */}
                <Field
                  label={t("common:descriptionOptional")}
                  htmlFor="agent-desc"
                  counter={`${description.length}/${limits.agent.description}`}
                >
                  <Textarea
                    id="agent-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={descPlaceholder}
                    rows={2}
                    maxLength={limits.agent.description}
                    className="resize-none"
                  />
                </Field>

                <Category>{t("create.sections.runtime")}</Category>
                {/* Runs on + Model */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("create.runsOn")}>
                    <Select
                      value={hosting}
                      onValueChange={(v) => v && setHosting(v as "hosted" | "local")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(val: unknown) =>
                            val === "hosted" ? t("hosting.hosted") : t("hosting.local")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hosted" disabled={!canHost}>
                          <span className="flex flex-col">
                            <span className="flex items-center gap-1.5">
                              {t("hosting.hosted")}
                              {!canHost && (
                                <span className="rounded-full bg-muted px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                                  {t("create.hostedComingSoon")}
                                </span>
                              )}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {t("create.hostedDescription")}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value="local">
                          <span className="flex flex-col">
                            <span>{t("hosting.local")}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {t("create.localDescription")}
                            </span>
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    label={t("common:model")}
                    hint={
                      hosted
                        ? hostRuntime?.claudeSeat === false
                          ? t("create.hostNoSeat")
                          : t("create.hostedInfo")
                        : undefined
                    }
                  >
                    <Select value={brainValue(backend, model)} onValueChange={handleBrainChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {() => {
                            const m = models.find((x) => x.id === model);
                            return [providerLabel, m?.label ?? model]
                              .filter(Boolean)
                              .join(" · ");
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDERS.map((p) => {
                          const blocked = providerBlock(p.id);
                          const blockedSuffix = blocked
                            ? ` · ${t(`create.modelUnavailable.${blocked}`)}`
                            : "";
                          // Current models lead; legacy ones get their own
                          // "Other models" group per provider.
                          const { current, other } = splitModels(
                            catalog.modelsFor(p.id)
                          );
                          const item = (m: CatalogModel) => (
                            <SelectItem
                              key={m.id}
                              value={brainValue(p.id, m.id)}
                              disabled={blocked !== null}
                            >
                              {m.label}
                            </SelectItem>
                          );
                          return (
                            <Fragment key={p.id}>
                              <SelectGroup>
                                <SelectLabel>
                                  {p.label}
                                  {blockedSuffix}
                                </SelectLabel>
                                {current.map(item)}
                              </SelectGroup>
                              {other.length > 0 && (
                                <SelectGroup>
                                  <SelectLabel>
                                    {`${p.label} · ${t("common:otherModels")}`}
                                    {blockedSuffix}
                                  </SelectLabel>
                                  {other.map(item)}
                                </SelectGroup>
                              )}
                            </Fragment>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

              </div>
            </div>

            )}

            {/* Page 2 — advanced settings. */}
            {page === 2 && (
            <div className="grid grid-cols-2 gap-x-6">
              <div className="space-y-5">
                <Category progress={completeness.byCat.details}>{t("create.stepLabels.details")}</Category>
                <Field
                  label={t("create.customInstructionsOptional")}
                  htmlFor="agent-instructions"
                  counter={`${customInstructions.length}/${INSTRUCTIONS_MAX}`}
                >
                  <Textarea
                    id="agent-instructions"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder={t("create.instructionsPlaceholder")}
                    rows={3}
                    maxLength={INSTRUCTIONS_MAX}
                    className="resize-none"
                  />
                </Field>

                {/* Switch rows */}
                <div className="divide-y divide-border rounded-lg border border-border">
                  <SwitchRow
                    icon={MapPin}
                    label={t("create.locationAccess")}
                    description={t("create.locationAccessDescription")}
                    checked={requiresLocation}
                    onCheckedChange={setRequiresLocation}
                  />
                  {/* Skip-permissions is a CLI-backend feature
                      (Claude Code: --dangerously-skip-permissions,
                      Codex: --dangerously-bypass-approvals-and-sandbox).
                      The plain Anthropic/OpenAI APIs have no permission
                      prompts to skip. */}
                  {hosting === "local" &&
                    (backend === "claude_cli" || backend === "codex_cli") && (
                      <SwitchRow
                        icon={ShieldOff}
                        label={t("create.skipPermissions")}
                        description={t("create.skipPermissionsDescription")}
                        checked={skipPermissions}
                        onCheckedChange={setSkipPermissions}
                      />
                    )}
                  {/* Computer use is a claude_cli-only capability today.
                      Hosted (Anthropic API), OpenAI, and Codex backends
                      don't run through our local MCP server. */}
                  {hosting === "local" && backend === "claude_cli" && (
                    <SwitchRow
                      icon={Monitor}
                      label={t("create.computerUse")}
                      description={t("create.computerUseDescription")}
                      checked={computerUseEnabled}
                      onCheckedChange={setComputerUseEnabled}
                    />
                  )}
                </div>

                {workspacesEnabled && (
                  <Field label={t("visibility.label")}>
                    <VisibilityField
                      value={visibilityOrgIds}
                      onChange={setVisibilityOrgIds}
                    />
                  </Field>
                )}
              </div>
              <div className="space-y-5 border-l border-border pl-6">
                {/* Integrations */}
                <Category progress={completeness.byCat.integrations}>{t("create.review.toolsLabel")}</Category>
                <div className="space-y-1.5">
                  {selectedTools.length === 0 && (
                    <div className="rounded-lg border border-border">
                      <SwitchRow
                        icon={Check}
                        label={t("create.noIntegrations.label")}
                        description={t("create.noIntegrations.description")}
                        checked={noIntegrations}
                        onCheckedChange={setNoIntegrations}
                      />
                    </div>
                  )}
                  <TooltipProvider delay={300}>
                  <div className="space-y-2">
                    {groupIntegrationTools(toolCatalog).length === 0 ? (
                      <p className="text-xs text-muted-foreground py-1">
                        {t("toolsTab.empty")}
                      </p>
                    ) : (
                      groupIntegrationTools(toolCatalog).map((group) => {
                        const enabledCount = group.tools.filter((tool) =>
                          selectedTools.includes(tool.name)
                        ).length;
                        const allEnabled = enabledCount === group.tools.length;
                        const expanded = expandedToolGroups.has(group.key);
                        const groupNames = group.tools.map((tool) => tool.name);
                        return (
                          <div
                            key={group.key}
                            className="rounded-lg border border-border"
                          >
                            {/* Header is the control: one switch for the whole
                                group; the chevron expands per-tool switches. */}
                            <div className="flex items-center gap-2 px-3 py-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedToolGroups((prev) => {
                                    const copy = new Set(prev);
                                    if (copy.has(group.key)) copy.delete(group.key);
                                    else copy.add(group.key);
                                    return copy;
                                  })
                                }
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                              >
                                {expanded ? (
                                  <ChevronDown className="w-3 h-3 shrink-0 text-text-muted" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 shrink-0 text-text-muted" />
                                )}
                                <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                                  {t(group.labelKey)}
                                </span>
                                <span
                                  className={cn(
                                    "text-[10px] tabular-nums",
                                    enabledCount > 0
                                      ? "text-primary"
                                      : "text-text-muted/70"
                                  )}
                                >
                                  {enabledCount}/{group.tools.length}
                                </span>
                              </button>
                              {group.credentialProvider &&
                                (wizardConnections[group.credentialProvider] ===
                                true ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                                    <Check className="w-2.5 h-2.5 text-success" />
                                    {t("toolsTab.available")}
                                  </span>
                                ) : wizardConnections[group.credentialProvider] ===
                                  false ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-5 px-2 text-[9px]"
                                    onClick={() =>
                                      void handleWizardConnect(
                                        group.credentialProvider!
                                      )
                                    }
                                  >
                                    {t("settings:connections.connectProvider", {
                                      provider: PROVIDER_LABELS[
                                        group.credentialProvider
                                      ],
                                    })}
                                  </Button>
                                ) : null)}
                              <Switch
                                checked={allEnabled}
                                onCheckedChange={(next) =>
                                  setSelectedTools((prev) =>
                                    next
                                      ? [
                                          ...prev,
                                          ...groupNames.filter(
                                            (n) => !prev.includes(n)
                                          ),
                                        ]
                                      : prev.filter((n) => !groupNames.includes(n))
                                  )
                                }
                              />
                            </div>
                            {expanded && (
                              <div className="divide-y divide-border border-t border-border">
                                {group.tools.map((tool) => {
                                  const checked = selectedTools.includes(tool.name);
                                  return (
                                    <label
                                      key={tool.id}
                                      className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-accent/50 transition-colors"
                                    >
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium">
                                          {tool.displayName || tool.name}
                                        </p>
                                        {tool.description && (
                                          <Tooltip>
                                            <TooltipTrigger
                                              render={
                                                <p className="text-[11px] text-text-muted line-clamp-1 cursor-default text-left">
                                                  {tool.description}
                                                </p>
                                              }
                                            />
                                            <TooltipContent
                                              side="bottom"
                                              align="start"
                                              className="max-w-sm whitespace-normal text-left leading-snug"
                                            >
                                              {tool.description}
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                      </div>
                                      <Switch
                                        checked={checked}
                                        onCheckedChange={(next) =>
                                          setSelectedTools((prev) =>
                                            next
                                              ? [...prev, tool.name]
                                              : prev.filter((n) => n !== tool.name)
                                          )
                                        }
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  </TooltipProvider>
                  <p className="text-[11px] text-text-muted">{t("create.toolsHint")}</p>
                </div>

                {/* Local-brain knobs — hosted agents use the host's shared seat. */}
                {hosting === "local" && (
                  <>
                    <Category>{t("create.stepLabels.brain")}</Category>
                    <div
                      className={cn(
                        "grid gap-3",
                        showEffort ? "grid-cols-2" : "grid-cols-1"
                      )}
                    >
                      <Field label={t("executionMode")}>
                        <Select
                          value={executionMode}
                          onValueChange={(v) => v && setExecutionMode(v)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(val: unknown) => {
                                const mode = EXECUTION_MODES.find(
                                  (m) => m.id === String(val)
                                );
                                return mode ? t(mode.labelKey) : String(val ?? "");
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {EXECUTION_MODES.filter((m) =>
                              supportedModes.includes(m.id)
                            ).map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {t(m.labelKey)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      {showEffort && (
                        <Field label={t("effortLabel")}>
                          <Select
                            value={effort || "high"}
                            onValueChange={(v) => v && setEffort(v)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue>
                                {(val: unknown) => {
                                  const level = EFFORT_LEVELS.find(
                                    (e) => e.id === String(val)
                                  );
                                  return level
                                    ? t(level.labelKey)
                                    : String(val ?? "");
                                }}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {EFFORT_LEVELS.map((e) => (
                                <SelectItem key={e.id} value={e.id}>
                                  {t(e.labelKey)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                    </div>

                    {needsApiKey && hasDefaultKey && (
                      <Field
                        label={t("create.providerApiKey", { provider: providerLabel })}
                        hint={
                          keySelection === "__default__"
                            ? t("create.keyOptions.usesDefaultHint")
                            : keySelection !== "__custom__"
                              ? t("create.keyOptions.pinnedHint")
                              : undefined
                        }
                      >
                        <Select
                          value={keySelection}
                          onValueChange={(v) => {
                            setKeySelection(String(v));
                            if (v !== "__custom__") setApiKey("");
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(val: unknown) => {
                                const v = String(val);
                                if (v === "__default__") return t("create.keyOptions.providerDefault");
                                if (v === "__custom__") return t("create.keyOptions.customForAgent");
                                return providerKeys.find((k) => k.id === v)?.label ?? v;
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">{t("create.keyOptions.providerDefault")}</SelectItem>
                            {providerKeys
                              .filter((k) => !k.isDefault)
                              .map((k) => (
                                <SelectItem key={k.id} value={k.id}>
                                  {k.label}
                                </SelectItem>
                              ))}
                            <SelectItem value="__custom__">{t("create.keyOptions.customForAgent")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}

                    {showApiKeyInput && (
                      <Field
                        label={
                          hasDefaultKey
                            ? t("create.newKeyThisAgent")
                            : t("create.providerApiKey", { provider: providerLabel })
                        }
                        htmlFor="llm-api-key"
                        hint={
                          hasDefaultKey
                            ? t("create.keySavedThisAgentHint")
                            : t("create.keySavedAsDefaultHint", { provider: providerLabel })
                        }
                      >
                        <div className="relative">
                          <Input
                            id="llm-api-key"
                            type={showApiKey ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk-..."
                            className="pr-10 font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-foreground"
                          >
                            {showApiKey ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </Field>
                    )}
                  </>
                )}

              </div>
            </div>
            )}
          </form>

          {/* Footer */}
          <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-border bg-background/80 px-6 py-3 backdrop-blur-sm">
            <div className="min-w-0">
              {error && (
                <p className="truncate text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted">
                  {t("create.stepOf", { current: page, total: 2 })}
                </span>
                <div className="flex items-center gap-1">
                  {[1, 2].map((p) => (
                    <span
                      key={p}
                      className={cn(
                        "h-1.5 rounded-full transition-all duration-300",
                        p === page ? "w-5 bg-primary" : "w-1.5 bg-border"
                      )}
                    />
                  ))}
                </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              {page === 1 ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onClose}
                    disabled={creating}
                  >
                    {t("common:cancel")}
                  </Button>
                  <Button
                    type="submit"
                    form="create-agent-form"
                    disabled={displayName.trim().length === 0 || drafting}
                  >
                    {t("common:next")}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => goToPage(1)}
                    disabled={creating}
                  >
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                    {t("common:back")}
                  </Button>
                  <Button
                    type="submit"
                    form="create-agent-form"
                    disabled={!canCreate}
                  >
                    {creating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                    {creating ? t("create.creatingLabel") : t("create.createAgent")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Alongside the form rather than inside its DialogContent, so the
        cropper is its own top-level layer and the form stays open behind
        it. */}
    {cropImageSrc && (
      <AvatarCropDialog
        open
        imageSrc={cropImageSrc}
        onClose={closeCrop}
        onConfirm={handleCropConfirm}
      />
    )}
    </>
  );
}

/** Small uppercase header that names a group of fields. */
function Category({
  children,
  progress,
}: {
  children: ReactNode;
  /** 0–100: this category's share of the completeness score that's earned.
   *  Omit for groups that don't score (runtime, brain). */
  progress?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {children}
      </p>
      {progress !== undefined && (
        <div className="flex items-center gap-1.5">
          <div className="h-1 w-14 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                progress === 100 ? "bg-warning" : "bg-primary"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span
            className={cn(
              "text-[10px] font-medium tabular-nums",
              progress === 100 ? "text-warning" : "text-text-muted"
            )}
          >
            {progress}%
          </span>
        </div>
      )}
    </div>
  );
}

/** Label + optional counter/hint around one control. */
function Field({
  label,
  htmlFor,
  counter,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  counter?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={htmlFor}>{label}</Label>
        {counter && (
          <span className="text-xs text-text-muted tabular-nums">{counter}</span>
        )}
      </div>
      {children}
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

/** One line of the switch list: icon, label, one-line description, switch. */
function SwitchRow({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  icon: typeof MapPin;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            checked ? "text-primary" : "text-text-muted"
          )}
        />
        <div className="min-w-0">
          <div className="text-xs font-medium">{label}</div>
          <div className="text-[10px] text-text-muted">{description}</div>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
