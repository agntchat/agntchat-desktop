import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@xyflow/react";
import { ListTodo, MessagesSquare, Repeat } from "lucide-react";
import { createRoutine, request } from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import type { GraphNode, Position } from "../../stores/workGraphStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KIND_COLORS } from "./GraphNode";

/** What the palette can put on the canvas. Each is a creation call pre-wired to where it lands. */
export type PaletteKind = "task" | "routine" | "room";

export const PALETTE_MIME = "application/x-agntchat-graph-node";

const PALETTE_ITEMS: Array<{ kind: PaletteKind; icon: typeof ListTodo; labelKey: string; color: string }> = [
  { kind: "task", icon: ListTodo, labelKey: "graph:palette.task", color: KIND_COLORS.task },
  { kind: "routine", icon: Repeat, labelKey: "graph:palette.routine", color: KIND_COLORS.routine },
  { kind: "room", icon: MessagesSquare, labelKey: "graph:palette.room", color: KIND_COLORS.conversation },
];

/**
 * Phase 4b: the palette. Drag a chip onto the canvas; drop it on an agent or
 * a room and the creation dialog opens pre-wired to that node (a task for
 * that agent, a routine run by that agent, a room with that agent, a task
 * in that room, a routine reporting to that room). Dropped on empty canvas
 * the dialog asks for the wiring instead.
 */
export function GraphPalette() {
  const { t } = useTranslation("graph");
  return (
    <Panel position="top-left">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-1.5 shadow-sm">
        <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("palette.title")}</p>
        {PALETTE_ITEMS.map(({ kind, icon: Icon, labelKey, color }) => (
          <div
            key={kind}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(PALETTE_MIME, kind);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={t("palette.dragHint")}
            className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent active:cursor-grabbing"
          >
            <Icon className="h-3.5 w-3.5" style={{ color }} />
            {t(labelKey)}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export interface PaletteDrop {
  kind: PaletteKind;
  /** The node the chip landed on, if any. */
  target: GraphNode | null;
  position: Position;
}

/** Ids of what was created, so the view can pin the new node where it was dropped. */
export interface Created {
  nodeId: string;
  label: string;
}

/**
 * The creation dialog behind a palette drop. Fields are the minimum each
 * endpoint needs; the wiring (which agent, which room) is taken from the
 * drop target when there is one and asked for otherwise.
 */
export function CreateNodeDialog({
  drop,
  agents,
  rooms,
  onCreated,
  onFailed,
  onClose,
}: {
  drop: PaletteDrop;
  agents: GraphNode[];
  rooms: GraphNode[];
  onCreated: (created: Created) => void;
  onFailed: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("graph");
  const currentUserId = useAuthStore((s) => s.participant?.id);
  const conversations = useChatStore((s) => s.conversations);

  const targetAgent = drop.target?.kind === "agent" ? drop.target : null;
  const targetRoom = drop.target?.kind === "conversation" ? drop.target : null;

  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [everyMinutes, setEveryMinutes] = useState("60");
  const [agentId, setAgentId] = useState(targetAgent?.rowId ?? agents[0]?.rowId ?? "");
  const [roomId, setRoomId] = useState(targetRoom?.rowId ?? "");
  const [busy, setBusy] = useState(false);

  // A task for an agent with no room chosen goes to the DM with that agent.
  const dmWith = useMemo(
    () =>
      (id: string) =>
        conversations.find(
          (c) =>
            c.type === "direct" &&
            (c.members ?? []).some((m) => m.participantId === id) &&
            (c.members ?? []).some((m) => m.participantId === currentUserId)
        ),
    [conversations, currentUserId]
  );

  useEffect(() => {
    if (drop.kind === "task" && !roomId && agentId) {
      const dm = dmWith(agentId);
      if (dm) setRoomId(dm.id);
    }
  }, [drop.kind, roomId, agentId, dmWith]);

  const canSubmit = (() => {
    if (busy) return false;
    switch (drop.kind) {
      case "task":
        return title.trim().length > 0 && roomId.length > 0;
      case "routine":
        return title.trim().length > 0 && instructions.trim().length > 0 && agentId.length > 0 && Number(everyMinutes) >= 1;
      case "room":
        return agentId.length > 0;
    }
  })();

  const submit = async () => {
    setBusy(true);
    try {
      switch (drop.kind) {
        case "task": {
          const task = await request<{ id: string; title: string }>(`/api/conversations/${roomId}/tasks`, {
            method: "POST",
            body: JSON.stringify({ title: title.trim(), ...(agentId ? { assignedTo: [agentId] } : {}) }),
          });
          onCreated({ nodeId: `task:${task.id}`, label: task.title });
          break;
        }
        case "routine": {
          const { routine } = await createRoutine({
            agent_id: agentId,
            name: title.trim(),
            instructions: instructions.trim(),
            schedule_type: "interval",
            schedule_config: { every_minutes: Math.max(1, Math.floor(Number(everyMinutes))) },
            ...(targetRoom ? { report_to: targetRoom.rowId } : {}),
          });
          onCreated({ nodeId: `routine:${routine.id}`, label: routine.name });
          break;
        }
        case "room": {
          const room = await request<{ id: string; title?: string }>("/api/conversations", {
            method: "POST",
            body: JSON.stringify({ type: "group", memberIds: [agentId], ...(title.trim() ? { title: title.trim() } : {}) }),
          });
          onCreated({ nodeId: `conversation:${room.id}`, label: room.title ?? title.trim() });
          break;
        }
      }
      onClose();
    } catch (e) {
      onFailed(e instanceof Error ? e.message : t("wiring.failed"));
    } finally {
      setBusy(false);
    }
  };

  const selectClass =
    "h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";

  const agentName = (id: string) => agents.find((a) => a.rowId === id)?.label ?? id;
  const roomName = (id: string) => rooms.find((r) => r.rowId === id)?.label ?? t("untitled");

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`createDialog.title.${drop.kind}`)}</DialogTitle>
          <DialogDescription>
            {drop.target
              ? t("createDialog.droppedOn", { name: drop.target.label ?? t("untitled") })
              : t("createDialog.droppedOnCanvas")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="graph-create-title">
              {drop.kind === "routine" ? t("createDialog.routineName") : drop.kind === "room" ? t("createDialog.roomTitle") : t("createDialog.taskTitle")}
            </Label>
            <Input id="graph-create-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus disabled={busy} />
          </div>

          {drop.kind === "routine" && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="graph-create-instructions">{t("createDialog.instructions")}</Label>
                <Textarea
                  id="graph-create-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                  disabled={busy}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="graph-create-every">{t("createDialog.everyMinutes")}</Label>
                <Input
                  id="graph-create-every"
                  type="number"
                  min={1}
                  value={everyMinutes}
                  onChange={(e) => setEveryMinutes(e.target.value)}
                  disabled={busy}
                />
              </div>
            </>
          )}

          {/* Wiring: fixed by the drop target, asked for otherwise. */}
          {drop.kind !== "task" || !targetRoom ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="graph-create-agent">
                {drop.kind === "task" ? t("createDialog.assignTo") : drop.kind === "routine" ? t("createDialog.runBy") : t("createDialog.withAgent")}
              </Label>
              {targetAgent ? (
                <p className="text-sm text-foreground">{agentName(targetAgent.rowId)}</p>
              ) : (
                <select id="graph-create-agent" className={selectClass} value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={busy}>
                  {drop.kind === "task" && <option value="">{t("createDialog.nobody")}</option>}
                  {agents.map((a) => (
                    <option key={a.rowId} value={a.rowId}>
                      {agentName(a.rowId)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          {drop.kind === "task" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="graph-create-room">{t("createDialog.inRoom")}</Label>
              {targetRoom ? (
                <p className="text-sm text-foreground">{roomName(targetRoom.rowId)}</p>
              ) : (
                <select id="graph-create-room" className={selectClass} value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={busy}>
                  <option value="">{t("createDialog.pickRoom")}</option>
                  {rooms.map((r) => (
                    <option key={r.rowId} value={r.rowId}>
                      {roomName(r.rowId)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {drop.kind === "routine" && targetRoom && (
            <p className="text-xs text-muted-foreground">{t("createDialog.reportsTo", { name: roomName(targetRoom.rowId) })}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("createDialog.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t("createDialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
