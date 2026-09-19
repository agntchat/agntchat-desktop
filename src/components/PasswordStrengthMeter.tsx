import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIRED_RULE_IDS,
  assessPassword,
  type PasswordStrengthLevel,
} from "@/lib/passwordStrength";

const SEGMENTS = 4;

const BAR_COLOR: Record<PasswordStrengthLevel, string> = {
  weak: "bg-danger",
  fair: "bg-warning",
  good: "bg-success",
  strong: "bg-success",
};

const TEXT_COLOR: Record<PasswordStrengthLevel, string> = {
  weak: "text-danger",
  fair: "text-warning",
  good: "text-success",
  strong: "text-success",
};

interface Props {
  password: string;
  /** Lets the meter call out a password built from the address. */
  email?: string;
  className?: string;
}

/**
 * Strength bar + the checklist of rules the signup form gates on. Renders
 * nothing until the person types, so the form stays short until it has
 * something to say.
 */
export function PasswordStrengthMeter({ password, email, className }: Props) {
  const { t } = useTranslation("auth");
  if (!password) return null;

  const { score, level, met, problem } = assessPassword(password, email);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < score ? BAR_COLOR[level] : "bg-muted"
              )}
            />
          ))}
        </div>
        <span className={cn("text-xs font-medium tabular-nums", TEXT_COLOR[level])}>
          {t(`passwordStrength.${level}`)}
        </span>
        <span className="sr-only">
          {t("passwordStrength.label")}: {t(`passwordStrength.${level}`)}
        </span>
      </div>

      {problem ? (
        <p className="text-xs text-danger">{t(`passwordRules.${problem}`)}</p>
      ) : (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
          {PASSWORD_REQUIRED_RULE_IDS.map((rule) => (
            <li
              key={rule}
              className={cn(
                "flex items-center gap-1 text-xs",
                met[rule] ? "text-success" : "text-muted-foreground"
              )}
            >
              {met[rule] ? (
                <Check className="h-3 w-3" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-current" />
              )}
              {t(`passwordRules.${rule}`, { min: PASSWORD_MIN_LENGTH })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
