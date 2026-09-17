import { useAgentStore } from "../stores/agentStore";
import {
  useHasWorkspaceCoMembers,
  useWorkspaceStore,
} from "../stores/workspaceStore";

export interface ComposeAvailability {
  /** The user has an agent or a workspace co-member to talk to, so the
   *  compose affordance (header pencil / FAB) is rendered. When false the
   *  control is hidden — empty-state copy must not point at it. */
  canCompose: boolean;
  /** Agents haven't resolved yet: first load, or the synchronous wipe +
   *  async refetch of a workspace switch. `canCompose` reads false here for
   *  structural reasons, not because the workspace is empty — hold any
   *  empty state that branches on it, or it flashes "nobody here yet" at a
   *  workspace that has agents. */
  pending: boolean;
}

/**
 * Single source of truth for "is there anyone to start a conversation with".
 * The compose control and every empty state that mentions it read this, so
 * the copy can never describe a button the user cannot see.
 */
export function useCanCompose(): ComposeAvailability {
  const hasAgents = useAgentStore((s) =>
    Object.values(s.agents).some((m) => m.agent.status !== "deactivated")
  );
  const agentsLoaded = useAgentStore((s) => s.loaded);
  const switching = useWorkspaceStore((s) => s.switching);
  const hasCoMembers = useHasWorkspaceCoMembers();

  return {
    canCompose: hasAgents || hasCoMembers,
    pending: !agentsLoaded || switching,
  };
}
