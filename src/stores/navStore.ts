import { create } from "zustand";
import { trackScreen } from "../lib/analytics";

export type View =
  | "chat"
  | "tasks"
  | "agents"
  | "friends"
  | "files"
  | "hosts"
  | "templates"
  | "previews"
  | "canvas"
  | "fleet"
  | "platform";

interface NavState {
  view: View;
  setView: (view: View) => void;
  /** Set when the memory island's "Review" is clicked — consumed by
   *  Dashboard to select the owning agent and open AgentConfig straight
   *  into its Memory section on the saved memory's scope tab. */
  memoryDeepLink: { agentId: string; tab: "agent" | "family" } | null;
  openMemoryDeepLink: (agentId: string, tab: "agent" | "family") => void;
  clearMemoryDeepLink: () => void;
  /** Set when the onboarding island's "Review" is clicked — consumed by
   *  Dashboard to select the agent and open AgentConfig straight into its
   *  Onboarding section. */
  onboardingDeepLink: { agentId: string } | null;
  openOnboardingDeepLink: (agentId: string) => void;
  clearOnboardingDeepLink: () => void;
  /** Which AgentConfig rail section is on screen (null when the pane is
   *  unmounted). Lets the onboarding island stay quiet when the user is
   *  already looking at that agent's Onboarding section. */
  agentConfigSection: string | null;
  setAgentConfigSection: (section: string | null) => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "chat",
  setView: (view) => {
    trackScreen(view);
    set({ view });
  },
  memoryDeepLink: null,
  openMemoryDeepLink: (agentId, tab) => set({ memoryDeepLink: { agentId, tab } }),
  clearMemoryDeepLink: () => set({ memoryDeepLink: null }),
  onboardingDeepLink: null,
  openOnboardingDeepLink: (agentId) => set({ onboardingDeepLink: { agentId } }),
  clearOnboardingDeepLink: () => set({ onboardingDeepLink: null }),
  agentConfigSection: null,
  setAgentConfigSection: (section) => set({ agentConfigSection: section }),
}));
