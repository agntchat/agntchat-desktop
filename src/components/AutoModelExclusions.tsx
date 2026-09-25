import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";

const TIER_KEYS: Record<number, string> = {
  1: "config.autoModels.tier1",
  2: "config.autoModels.tier2",
  3: "config.autoModels.tier3",
};

type TierModel = { id: string; tier: number; legacy?: boolean };

/**
 * The models an auto agent may run on, each switchable off. An excluded
 * model is never picked; the server moves a turn it would have taken to
 * the next model up (`Models.model_for_tier/5`). The last model left can't
 * be switched off — the server rejects an empty set too.
 *
 * Current models lead; legacy ones (fallbacks behind their tier's current
 * model) sit collapsed under "Other models", like the model picker.
 */
export function AutoModelExclusions({
  tierModels,
  excluded,
  labelFor,
  onChange,
}: {
  tierModels: TierModel[];
  excluded: string[];
  labelFor: (id: string) => string;
  onChange: (excluded: string[]) => void;
}) {
  const { t } = useTranslation("agents");
  const [showOther, setShowOther] = useState(false);
  if (tierModels.length === 0) return null;
  const enabledCount = tierModels.filter((m) => !excluded.includes(m.id)).length;
  const current = tierModels.filter((m) => !m.legacy);
  const other = tierModels.filter((m) => m.legacy);

  const row = (m: TierModel) => {
    const on = !excluded.includes(m.id);
    const locked = on && enabledCount <= 1;
    const tierKey = TIER_KEYS[m.tier];
    return (
      <div key={m.id} className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm">{labelFor(m.id)}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {tierKey ? t(tierKey) : null}
          </span>
        </div>
        <Switch
          size="sm"
          checked={on}
          disabled={locked}
          title={locked ? t("config.autoModels.lastOne") : undefined}
          onCheckedChange={(next) =>
            onChange(next ? excluded.filter((id) => id !== m.id) : [...excluded, m.id])
          }
        />
      </div>
    );
  };

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="space-y-0.5">
        <Label className="text-xs">{t("config.autoModels.title")}</Label>
        <p className="text-[11px] text-muted-foreground">{t("config.autoModels.hint")}</p>
      </div>
      <div className="space-y-1.5">{current.map(row)}</div>
      {other.length > 0 && (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={showOther}
            onClick={() => setShowOther((v) => !v)}
          >
            {showOther ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {t("common:otherModels")} ({other.length})
          </button>
          {showOther && (
            <>
              <p className="text-[11px] text-muted-foreground">
                {t("config.autoModels.otherHint")}
              </p>
              {other.map(row)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
