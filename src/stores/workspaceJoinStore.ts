import { create } from "zustand";

/** What the join dialog needs to render — both the live toast event and a
 *  row from `pendingInvites` map onto it. */
export interface JoinableInvite {
  id: string;
  organizationId: string;
  organizationName?: string | null;
  organizationAvatarUrl?: string | null;
  role?: string | null;
  invitedByName?: string | null;
}

/**
 * The invite the user is in the middle of accepting. Every "Join" entry
 * point (invite toast, switcher banner) hands off here instead of calling
 * `acceptInvite` directly, so the JoinWorkspaceDialog can first ask which
 * all-workspaces agents should come along — mounted once in the shell.
 */
interface WorkspaceJoinState {
  invite: JoinableInvite | null;
  begin: (invite: JoinableInvite) => void;
  cancel: () => void;
}

export const useWorkspaceJoinStore = create<WorkspaceJoinState>((set) => ({
  invite: null,
  begin: (invite) => set({ invite }),
  cancel: () => set({ invite: null }),
}));
