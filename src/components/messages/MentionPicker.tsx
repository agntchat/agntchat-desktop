import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bot, Plus } from "lucide-react";
import { cn, getInitials } from "../../lib/utils";
import type { Agent, ConversationMember, OrganizationMembership } from "../../lib/api";

export interface MentionItem {
  participantId: string;
  displayName: string;
  avatarUrl?: string;
  type: "human" | "agent";
  /** True if already a conversation member — false if pulled from the agent
   *  directory or the workspace roster (the `Add` badge hints the user will
   *  add them on send). */
  isMember: boolean;
  /** Workspace role, on non-member humans only — the disambiguator when two
   *  people in a workspace share a display name. */
  workspaceRole?: string;
}

interface Props {
  query: string;
  members: ConversationMember[];
  allAgents?: Agent[];
  /** Workspace roster, for @mentioning a co-member who isn't in this
   *  conversation yet. Pass it only when the viewer can actually add people
   *  (conversation admins): the server applies the same gate, so offering a
   *  name we can't act on would just fail silently. */
  workspaceMembers?: OrganizationMembership[];
  currentUserId?: string;
  selectedIndex: number;
  onSelect: (item: MentionItem) => void;
}

/**
 * Extract the active @mention query from a textarea. Supports plain (`@foo`)
 * and bracketed (`@[Display Name`) forms. Returns null if the cursor isn't
 * currently inside a mention token.
 */
export function extractMentionQuery(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos);
  const bracketMatch = before.match(/@\[([^\]]*)$/);
  const plainMatch = before.match(/@(\w*)$/);
  const match = bracketMatch ?? plainMatch;
  return match ? match[1] ?? "" : null;
}

/**
 * Replace the active `@query` token at `cursorPos` with the given display
 * name. Plain `@Name ` even for multi-word names — the server resolves those
 * (full-name scan in Mentions.resolve_pool) and clients render them bold, so
 * users never see the legacy `@[Name]` bracket syntax.
 */
export function insertMention(
  text: string,
  cursorPos: number,
  displayName: string
): { text: string; cursor: number } {
  const before = text.slice(0, cursorPos);
  const after = text.slice(cursorPos);
  const mention = `@${displayName} `;
  const newBefore = before.replace(/@\[[^\]]*$|@\w*$/, mention);
  return { text: newBefore + after, cursor: newBefore.length };
}

export function getMentionItems(
  query: string,
  members: ConversationMember[],
  allAgents: Agent[] | undefined,
  currentUserId: string | undefined,
  workspaceMembers?: OrganizationMembership[]
): MentionItem[] {
  const q = query.toLowerCase();
  const results: MentionItem[] = [];
  const seen = new Set<string>();

  for (const m of members) {
    if (m.participantId === currentUserId) continue;
    const name = m.participant?.displayName ?? "";
    if (!name.toLowerCase().includes(q)) continue;
    seen.add(m.participantId);
    results.push({
      participantId: m.participantId,
      displayName: name,
      avatarUrl: m.participant?.avatarUrl,
      type: m.participant?.type ?? "human",
      isMember: true,
    });
  }

  if (allAgents) {
    for (const agent of allAgents) {
      if (seen.has(agent.id)) continue;
      if (agent.status !== "active") continue;
      const name = agent.displayName ?? "";
      if (!name.toLowerCase().includes(q)) continue;
      seen.add(agent.id);
      results.push({
        participantId: agent.id,
        displayName: name,
        avatarUrl: agent.avatarUrl,
        type: "agent",
        isMember: false,
      });
    }
  }

  // Workspace co-members who aren't in this conversation yet. Mentioning one
  // adds them (server-side, Mentions.auto_add_mentioned_participants), which
  // is the only way to get a person into a channel from the composer.
  if (workspaceMembers) {
    for (const m of workspaceMembers) {
      if (seen.has(m.participantId)) continue;
      if (m.participantId === currentUserId) continue;
      if (m.participant?.type !== "human") continue;
      const name = m.participant?.displayName ?? "";
      if (!name.toLowerCase().includes(q)) continue;
      seen.add(m.participantId);
      results.push({
        participantId: m.participantId,
        displayName: name,
        avatarUrl: m.participant?.avatarUrl,
        type: "human",
        isMember: false,
        workspaceRole: m.role,
      });
    }
  }

  return results.slice(0, 6);
}

export function MentionPicker({
  query,
  members,
  allAgents,
  workspaceMembers,
  currentUserId,
  selectedIndex,
  onSelect,
}: Props) {
  const { t } = useTranslation("common");
  const items = useMemo(
    () => getMentionItems(query, members, allAgents, currentUserId, workspaceMembers),
    [query, members, allAgents, currentUserId, workspaceMembers]
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 z-40 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
      role="listbox"
    >
      {items.map((item, i) => (
        <button
          key={item.participantId}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          onMouseDown={(e) => {
            // Prevent the textarea from losing focus before we commit
            e.preventDefault();
            onSelect(item);
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
            i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
          )}
        >
          <Avatar className="h-6 w-6">
            {item.avatarUrl && <AvatarImage src={item.avatarUrl} />}
            <AvatarFallback className="text-[10px]">
              {item.type === "agent" ? (
                <Bot className="h-3 w-3" />
              ) : (
                getInitials(item.displayName)
              )}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm">{item.displayName}</span>
          {/* Two people in a workspace can share a display name (and do), so
              a non-member human carries their role to tell them apart. */}
          {item.workspaceRole && (
            <span className="text-[11px] text-muted-foreground">
              {t(`friends:role.${item.workspaceRole}`, { defaultValue: item.workspaceRole })}
            </span>
          )}
          {item.type === "agent" && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {t("agent")}
            </span>
          )}
          {!item.isMember && (
            <span className="ml-auto flex items-center gap-0.5 rounded border border-border px-1.5 py-0 text-[10px] text-muted-foreground">
              <Plus className="h-2.5 w-2.5" />
              {t("add")}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
