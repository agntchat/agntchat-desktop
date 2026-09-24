import { useTranslation } from "react-i18next";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";

const TIER_KEYS: Record<number, string> = {
  1: "config.autoModels.tier1",
  2: "config.autoModels.tier2",
  3: "config.autoModels.tier3",
};

/**
 * The models an auto agent may run on, each switchable off. An excluded
 * model is never picked; the server moves a turn it would have taken to
 * the next model up (`Models.model_for_tier/5`). The last model left can't
 * be switched off — the server rejects an empty set too.
 */
export function AutoModelExclusions({
  tierModels,
  excluded,
  labelFor,
  onChange,
}: {
  tierModels: { id: string; tier: number }[];
  excluded: string[];
  labelFor: (id: string) => string;
  onChange: (excluded: string[]) => void;
}) {
  const { t } = useTranslation("agents");
  if (tierModels.length === 0) return null;
  const enabledCount = tierModels.filter((m) => !excluded.includes(m.id)).length;

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="space-y-0.5">
        <Label className="text-xs">{t("config.autoModels.title")}</Label>
        <p className="text-[11px] text-muted-foreground">{t("config.autoModels.hint")}</p>
      </div>
      <div className="space-y-1.5">
        {tierModels.map((m) => {
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
                  onChange(
                    next ? excluded.filter((id) => id !== m.id) : [...excluded, m.id]
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
