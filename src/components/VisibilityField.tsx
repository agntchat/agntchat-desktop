import { useTranslation } from "react-i18next";
import { Check, Globe2, ListChecks } from "lucide-react";
import { useActiveWorkspace, useWorkspaces } from "../stores/workspaceStore";
import { cn } from "../lib/utils";
import { WorkspaceAvatar } from "./WorkspaceSwitcher";

/**
 * Workspace visibility: either the agent follows the owner into EVERY
 * workspace (organizationIds null), or it's pinned to a selected SET of
 * workspaces (any the owner belongs to — Personal included, so
 * "Personal only" is just the set {Personal}). Membership is the
 * tenancy boundary, so the checklist offers every workspace with no
 * switch-then-pin dance. Unchecking the last workspace falls back to
 * All workspaces.
 *
 * `value`: null = all workspaces; otherwise the pinned workspace ids.
 *
 * Rendered by VisibilitySection, which owns the title and the save.
 */
export function VisibilityField({
  value,
  onChange,
}: {
  value: string[] | null;
  onChange: (v: string[] | null) => void;
}) {
  const { t } = useTranslation("agents");
  const allWorkspaces = useWorkspaces();
  const personal = allWorkspaces.find((w) => w.isPersonal);
  const active = useActiveWorkspace();
  // Turning "All workspaces" off seeds the pin set with the workspace
  // the user is currently in — that's almost always the one they mean
  // to scope to. Personal is only the fallback when no active workspace
  // is resolvable.
  const seed = active ?? personal;
  // Pins to workspaces the owner has since left stay representable so
  // opening this panel doesn't silently drop them from the set.
  const orphanedIds = (value ?? []).filter(
    (id) => !allWorkspaces.some((w) => w.id === id)
  );

  const toggle = (id: string) => {
    const current = value ?? [];
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    onChange(next.length === 0 ? null : next);
  };

  const isAll = value === null;

  // The two modes read as a choice, not a checkbox that disables a list —
  // picking "Selected" seeds the set and reveals the workspace tiles.
  const modes = [
    {
      all: true,
      icon: Globe2,
      title: t("visibility.all"),
      hint: t("visibility.allHint"),
    },
    {
      all: false,
      icon: ListChecks,
      title: t("visibility.selected"),
      hint: t("visibility.selectedHint"),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {modes.map((mode) => {
          const selected = mode.all === isAll;
          return (
            <button
              key={String(mode.all)}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(mode.all ? null : seed ? [seed.id] : [])}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-foreground/20 hover:bg-accent/50"
              )}
            >
              <div className="flex items-center gap-2">
                <mode.icon
                  className={cn(
                    "h-4 w-4 flex-shrink-0",
                    selected ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    selected ? "text-primary" : "text-foreground"
                  )}
                >
                  {mode.title}
                </span>
                {selected && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-primary" />}
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {mode.hint}
              </p>
            </button>
          );
        })}
      </div>

      {/* Workspace tiles — only in Selected mode. Unchecking the last one
          drops back to All (see toggle), which re-hides this grid. */}
      {!isAll && (
        <div className="grid gap-2 sm:grid-cols-2">
          {allWorkspaces.map((w) => {
            const checked = (value ?? []).includes(w.id);
            return (
              <WorkspaceChoice
                key={w.id}
                name={w.name}
                avatarUrl={w.avatarUrl}
                isPersonal={w.isPersonal}
                sub={w.role ? t(`settings:workspace.roles.${w.role}`) : undefined}
                checked={checked}
                onToggle={() => toggle(w.id)}
              />
            );
          })}
          {/* Pins to workspaces the owner has left — nameless, but shown so
              they stay unpickable-by-accident rather than silently dropped. */}
          {orphanedIds.map((id) => (
            <WorkspaceChoice
              key={id}
              name={t("settings:workspace.fallbackName")}
              isPersonal={false}
              checked
              onToggle={() => toggle(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One selectable workspace tile in the Visibility picker. */
function WorkspaceChoice({
  name,
  avatarUrl,
  isPersonal,
  sub,
  checked,
  onToggle,
}: {
  name: string;
  avatarUrl?: string | null;
  isPersonal: boolean;
  sub?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
        checked
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/20 hover:bg-accent/50"
      )}
    >
      <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg">
        <WorkspaceAvatar name={name} avatarUrl={avatarUrl} isPersonal={isPersonal} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{name}</div>
        {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <span
        className={cn(
          "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}
