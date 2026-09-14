import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ListFilter,
  ListTodo,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Input } from "../ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useUnifiedActions, type Person } from "../../hooks/useUnifiedActions";
import { useTodoStore } from "../../stores/todoStore";
import { useTaskStore } from "../../stores/taskStore";
import { useAuthStore } from "../../stores/authStore";
import ActionRow from "./ActionRow";
import { cn, getInitials } from "../../lib/utils";
import type { ActionSelection } from "./selection";

/**
 * The unified Actions list — merges to-dos, agent tasks, reminders, and
 * routines into one kind-segmented feed (To-dos, Actions, Reminders,
 * Routines, then a collapsible Completed section). Direct port of
 * mobile's app/(main)/(tabs)/(tasks)/index.tsx, replacing the old
 * Tasks/To-dos tab split — everything lives in this one list now.
 *
 * Rows never open a modal: picking one hands the selection up to
 * `TasksView`, which renders it in the detail column.
 *
 * Chrome above the list is split by purpose. *Creating* is one field:
 * Enter makes a title-only to-do, and while the field is in use a row of
 * named types appears beneath it — the same text, opened as a to-do or a
 * reminder in the detail column. Naming them is the point (an unlabelled
 * bell never said "this makes a reminder"), and hiding them at rest is
 * what keeps them from reading as a second copy of the field.
 * *Narrowing* (person filter, search) lives in the header and stays
 * collapsed until used, so the resting state is the list itself rather
 * than a row of people chips nobody asked for.
 */
export function ActionsList({
  width,
  innerRef,
  selection,
  onSelect,
}: {
  /** Resizable width in px (from useResizableWidth). */
  width?: number;
  /** Ref to the aside — its left edge is the resize drag origin. */
  innerRef?: React.RefObject<HTMLElement | null>;
  /** What the detail column is showing (null → a task, or nothing). */
  selection: ActionSelection;
  onSelect: (next: ActionSelection) => void;
}) {
  const { t } = useTranslation("tasks");
  const {
    sections,
    people,
    personFilter,
    setPersonFilter,
    searchQuery,
    setSearchQuery,
    showCompleted,
    setShowCompleted,
    doneCount,
    loading,
    agentsById,
    myId,
  } = useUnifiedActions();

  const addTodo = useTodoStore((s) => s.addTodo);
  const myParticipantId = useAuthStore((s) => s.participant?.id);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);

  const [draft, setDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const submitDraft = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const created = await addTodo({ title });
    if (!created) setDraft(title);
  };

  // The type row belongs to the field: it shows while you're composing
  // (focused, or with text parked in it) and folds away the rest of the
  // time so the resting create area is a single row.
  const showTypes = composing || draft.trim().length > 0;

  const hasAnyFilter = personFilter !== "all" || searchQuery.length > 0;
  const totalItems = sections.reduce((n, s) => n + s.data.length, 0);

  const personLabel = (p: Person | { id: "all" }) => {
    if (p.id === "all") return t("todo.filterAll");
    if (p.id === myParticipantId) return t("common:you");
    return (p as Person).displayName;
  };

  const activePerson = people.find((p) => p.id === personFilter);

  return (
    <aside
      ref={innerRef}
      className="relative z-0 shrink-0 flex flex-col bg-canvas"
      style={{ width: width ?? 320, WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        className="h-14 shrink-0 px-4 border-b border-border flex items-center gap-1"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <h2 className="flex-1 text-sm font-semibold text-foreground">{t("nav:tasks")}</h2>
        {/* Narrowing controls live here, out of the create area. They
            show as icons because their state is visible elsewhere: an
            active person filter renders a chip above the list. */}
        <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          {people.length > 0 && (
            <PersonFilterMenu
              people={people}
              personFilter={personFilter}
              setPersonFilter={setPersonFilter}
              personLabel={personLabel}
            />
          )}
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={t("common:search")}
            title={t("common:search")}
            className={cn(
              "rounded-full p-1.5 hover:bg-muted hover:text-foreground",
              searchOpen || searchQuery ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      {/* Create area — the quick-add field makes a title-only to-do on
          Enter; the palette beneath it names each thing you can create
          and opens the full editor for it in the detail column. */}
      <div className="pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            placeholder={t("unified.addPlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setComposing(true)}
            onBlur={() => setComposing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setDraft("");
            }}
            className="h-9 flex-1 text-sm"
          />
        </div>
        {showTypes && (
          <div className="mt-1.5 flex items-center gap-1.5 pl-6">
            <span className="text-[11px] text-muted-foreground">{t("unified.openAs")}</span>
            <CreateChip
              icon={ListTodo}
              label={t("unified.todoType")}
              onClick={() => onSelect({ kind: "todo", id: null, draftTitle: draft })}
            />
            <CreateChip
              icon={Bell}
              label={t("unified.reminderType")}
              onClick={() => onSelect({ kind: "reminder", id: null, draftTitle: draft })}
            />
          </div>
        )}
      </div>

      {searchOpen && (
        <div className="flex items-center gap-1.5 pb-2">
          <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              placeholder={t("unified.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSearchOpen(false);
            }}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* A set person filter is the only thing that puts people back on
          screen — as one removable chip, not the whole roster. */}
      {personFilter !== "all" && (
        <div className="flex items-center gap-1.5 pb-2">
          <button
            type="button"
            onClick={() => setPersonFilter("all")}
            title={t("unified.clearFilter")}
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
          >
            {activePerson && <PersonAvatar person={activePerson} />}
            <span className="truncate">{activePerson ? personLabel(activePerson) : personFilter}</span>
            <X className="h-3 w-3 shrink-0" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : totalItems === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <ListTodo className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              {hasAnyFilter ? t("unified.noMatching") : t("unified.empty")}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              {hasAnyFilter ? t("common:tryAdjustingFilters") : t("unified.emptyHint")}
            </p>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.key}>
              <SectionHeader
                sectionKey={section.key}
                count={section.key === "done" ? doneCount : section.data.length}
                showCompleted={showCompleted}
                onToggleCompleted={() => setShowCompleted((v) => !v)}
              />
              {section.data.map((item) => (
                <ActionRow
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  agentsById={agentsById}
                  myId={myId}
                  isSelected={
                    item.kind === "task"
                      ? !selection && selectedTaskId === item.id
                      : selection?.kind === item.kind && selection.id === item.id
                  }
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        )}
      </div>
      </div>
    </aside>
  );
}

/** One named thing you can create, spelled out rather than implied by an
 *  icon — the whole point of the palette. */
function CreateChip({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof ListTodo;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // Mouse-down on a chip would blur the field and unmount this row
      // before the click resolved, so focus stays put.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-input bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function PersonAvatar({ person }: { person: Person }) {
  return (
    <Avatar className="h-4 w-4">
      {person.avatarUrl && <AvatarImage src={person.avatarUrl} />}
      <AvatarFallback className="text-[8px]">
        {person.isAgent ? <Bot className="h-2.5 w-2.5" /> : getInitials(person.displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Person filter as a dropdown instead of an always-on chip rail: the
 *  roster only costs screen space while you're choosing from it. */
function PersonFilterMenu({
  people,
  personFilter,
  setPersonFilter,
  personLabel,
}: {
  people: Person[];
  personFilter: string;
  setPersonFilter: (id: string) => void;
  personLabel: (p: Person | { id: "all" }) => string;
}) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isFiltered = personFilter !== "all";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("unified.filterPerson")}
        title={t("unified.filterPerson")}
        className={cn(
          "rounded-full p-1.5 hover:bg-muted hover:text-foreground",
          isFiltered || open ? "text-primary" : "text-muted-foreground"
        )}
      >
        <ListFilter className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-30 mt-1 max-h-72 w-52 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {([{ id: "all" } as const, ...people] as (Person | { id: "all" })[]).map((p) => {
            const isActive = personFilter === p.id;
            return (
              <button
                type="button"
                key={p.id}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  setPersonFilter(p.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                  isActive ? "text-primary" : "text-foreground"
                )}
              >
                {p.id === "all" ? (
                  <ListFilter className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <PersonAvatar person={p as Person} />
                )}
                <span className="min-w-0 flex-1 truncate">{personLabel(p)}</span>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  sectionKey,
  count,
  showCompleted,
  onToggleCompleted,
}: {
  sectionKey: "todos" | "tasks" | "reminders" | "routines" | "done";
  count: number;
  showCompleted: boolean;
  onToggleCompleted: () => void;
}) {
  const { t } = useTranslation("tasks");

  if (sectionKey === "done") {
    return (
      <button
        onClick={onToggleCompleted}
        className="mt-3 flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {showCompleted ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {t("todo.completedSection")}
        <span className="text-muted-foreground/70">({count})</span>
      </button>
    );
  }

  const label =
    sectionKey === "todos"
      ? t("todo.tab")
      : sectionKey === "tasks"
        ? t("actions")
        : sectionKey === "reminders"
          ? t("unified.remindersSection")
          : t("agents:routines.title");

  return (
    <div className="mt-3 flex items-center gap-1.5 px-3 py-1">
      <span className="text-[11px] font-semibold text-muted-foreground">
        {label} ({count})
      </span>
    </div>
  );
}
