import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * "BETA" chip, shown beside the agntchat wordmark wherever the wordmark
 * appears. Kept as one component (and mirrored in `web/src/components/`) so
 * dropping the beta label at launch is a single deletion rather than a hunt
 * through every brand surface.
 *
 * Deliberately muted — `outline` rather than a filled accent. This sits next
 * to the product name on first-run screens; it should read as a qualifier,
 * not compete with the name it qualifies.
 */
export function BetaBadge({ className }: { className?: string }) {
  const { t } = useTranslation("common");

  return (
    <Badge
      variant="secondary"
      className={cn(
        // A filled chip rather than an outline: at 10px the outline variant's
        // border is nearly invisible against a card on the dark theme, and the
        // label degrades into loose floating text.
        "px-1.5 py-0 text-[10px] font-semibold tracking-wider text-muted-foreground",
        className
      )}
    >
      {t("beta")}
    </Badge>
  );
}
