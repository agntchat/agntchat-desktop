import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/authStore";
import * as api from "../lib/api";
import { WAITLIST_URL } from "../lib/marketingSite";
import { Bot, KeyRound, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import { LEGAL_URLS } from "../lib/legal";
import { BetaBadge } from "./BetaBadge";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { assessPassword, PASSWORD_MIN_LENGTH } from "../lib/passwordStrength";
import { cn } from "@/lib/utils";

/** Open a URL in the system browser — Tauri native with window.open fallback. */
function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

// Backend `invite_code_<reason>` error codes → catalog keys, so the gate
// says the same thing whether a code fails at the check or at submit.
const INVITE_ERROR_KEYS = {
  required: "auth:invite.errors.required",
  invalid: "auth:invite.errors.invalid",
  used: "auth:invite.errors.used",
  expired: "auth:invite.errors.expired",
  email_mismatch: "auth:invite.errors.email_mismatch",
} as const;

function inviteErrorKey(reason: string | undefined): string | null {
  if (!reason) return null;
  return (INVITE_ERROR_KEYS as Record<string, string>)[reason] ?? null;
}

/** True when the ISO "YYYY-MM-DD" birth date is at least 16 years ago. */
function isAtLeast16(isoDate: string): boolean {
  const dob = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 16);
  return dob <= cutoff;
}

export function LoginScreen() {
  const { t } = useTranslation("auth");
  const { login, signup, loading, error, confirmationMessage } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [analyticsOptIn, setAnalyticsOptIn] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [passwordError, setPasswordError] = useState<
    "errors.passwordTooShort" | "errors.passwordTooWeak" | "errors.passwordsDontMatch" | null
  >(null);
  const [birthDateError, setBirthDateError] = useState<
    "birthDateRequired" | "ageTooYoung" | null
  >(null);

  // Invite-only signup: the backend says whether a code is needed
  // (`signup_requires_invite` flag), so the gate vanishes the moment the
  // operator turns it off. Until a code is accepted, the signup form is
  // the code field alone.
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [acceptedInvite, setAcceptedInvite] = useState<{ code: string; email: string | null } | null>(
    null
  );

  useEffect(() => {
    if (!isSignup || inviteRequired !== null) return;
    let cancelled = false;
    api
      .signupPolicy()
      .then((policy) => {
        if (!cancelled) setInviteRequired(policy.inviteRequired);
      })
      .catch(() => {
        if (!cancelled) setInviteRequired(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignup, inviteRequired]);

  const checkCode = useCallback(async () => {
    const code = codeInput.trim();
    if (!code) {
      setCodeError(t("invite.errors.required"));
      return;
    }
    setCheckingCode(true);
    setCodeError("");
    try {
      const res = await api.checkInviteCode(code);
      if (res.valid && res.code) {
        setAcceptedInvite({ code: res.code, email: res.email ?? null });
        if (res.email) setEmail(res.email);
      } else {
        const key = inviteErrorKey(res.reason);
        setCodeError(key ? t(key) : t("invite.errors.invalid"));
      }
    } catch {
      setCodeError(t("invite.errors.checkFailed"));
    } finally {
      setCheckingCode(false);
    }
  }, [codeInput, t]);

  // A code that died between the check and the submit (spent elsewhere,
  // expired) sends the person back to the gate with the reason.
  useEffect(() => {
    if (!error) return;
    const code = useAuthStore.getState().errorCode ?? "";
    const reason = code.startsWith("invite_code_") ? code.slice("invite_code_".length) : "";
    const key = inviteErrorKey(reason);
    if (key) {
      setAcceptedInvite(null);
      setCodeError(t(key));
      useAuthStore.setState({ error: null, errorCode: null });
    }
  }, [error, t]);

  const gateOpen = isSignup && inviteRequired === true && !acceptedInvite;
  const emailLocked = isSignup && !!acceptedInvite?.email;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (gateOpen) {
      await checkCode();
      return;
    }
    if (isSignup) {
      // Password rules first: they sit at the top of the form, so a failure
      // here shouldn't be reported under the consent block.
      const assessment = assessPassword(password, email);
      if (password.length < PASSWORD_MIN_LENGTH) {
        setPasswordError("errors.passwordTooShort");
        return;
      }
      if (!assessment.acceptable) {
        setPasswordError("errors.passwordTooWeak");
        return;
      }
      if (password !== confirmPassword) {
        setPasswordError("errors.passwordsDontMatch");
        return;
      }
      setPasswordError(null);
      if (!birthDate) {
        setBirthDateError("birthDateRequired");
        return;
      }
      if (!isAtLeast16(birthDate)) {
        setBirthDateError("ageTooYoung");
        return;
      }
      if (!acceptedTerms) {
        setConsentError(true);
        return;
      }
      await signup(email, password, displayName || undefined, {
        acceptedTerms: true,
        birthDate,
        marketingOptIn,
        analyticsOptIn,
        inviteCode: acceptedInvite?.code,
      });
    } else {
      await login(email, password);
    }
  };

  // Until the policy lands we don't know whether the invite gate or the full
  // form belongs here — render neither, rather than flashing the form and
  // replacing it a beat later.
  if (isSignup && inviteRequired === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg">
        <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
      </div>
    );
  }

  // The signup form carries twice the fields of the sign-in form, which
  // overflowed the default 680px window. It gets a wider, tighter card with
  // paired rows; the shell scrolls so the short-window case still works.
  const signupForm = isSignup && !gateOpen;

  return (
    // `my-auto` rather than `items-center`: a card taller than the window
    // still scrolls to its own top instead of being clipped.
    <div className="flex h-screen w-screen justify-center overflow-y-auto bg-bg p-4">
      <Card className={cn("my-auto w-[400px] p-10", signupForm && "w-[440px] p-7")}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold text-text">agntchat</h1>
          <BetaBadge />
        </div>
        <p className={cn("text-text-secondary text-sm mb-8", signupForm && "mb-5")}>
          {gateOpen ? t("invite.subtitle") : t("tagline")}
        </p>

        <form onSubmit={handleSubmit} className={cn("space-y-4", signupForm && "space-y-3")}>
          {gateOpen && (
            <div className="space-y-1.5">
              <Label htmlFor="inviteCode" className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> {t("invite.codeLabel")}
              </Label>
              <Input
                id="inviteCode"
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder={t("invite.placeholder")}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono uppercase tracking-widest"
                disabled={checkingCode}
                autoFocus
              />
              {codeError && (
                <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
                  {codeError}
                </div>
              )}
              <p className="text-sm text-text-secondary pt-1">
                {t("invite.noCode")}{" "}
                <button
                  type="button"
                  onClick={() => openExternal(WAITLIST_URL)}
                  className="text-primary underline hover:text-primary/80"
                >
                  {t("invite.joinWaitlist")}
                </button>
              </p>
            </div>
          )}

          {isSignup && !gateOpen && acceptedInvite && (
            <div className="flex items-start justify-between gap-3 text-sm text-success bg-success/10 px-3 py-2 rounded-md">
              <span>{t("invite.accepted", { code: acceptedInvite.code })}</span>
              <button
                type="button"
                className="shrink-0 text-xs text-text-secondary hover:underline"
                onClick={() => {
                  setAcceptedInvite(null);
                  setCodeError("");
                }}
              >
                {t("invite.change")}
              </button>
            </div>
          )}

          {/* Name and date of birth share a row — two short fields that
              would otherwise cost the form 120px of height. */}
          {signupForm && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="displayName">{t("displayName")}</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("placeholders.yourName")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="birthDate">{t("birthDate")}</Label>
                <Input
                  id="birthDate"
                  type="date"
                  value={birthDate}
                  onChange={(e) => {
                    setBirthDate(e.target.value);
                    if (e.target.value) setBirthDateError(null);
                  }}
                />
              </div>
            </div>
          )}

          {!gateOpen && (
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("placeholders.email")}
                required
                readOnly={emailLocked}
                disabled={emailLocked}
              />
              {emailLocked && (
                <p className="text-xs text-text-secondary">{t("invite.emailLocked", { email })}</p>
              )}
            </div>
          )}

          {!gateOpen && !isSignup && (
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("password")}
                required
              />
            </div>
          )}

          {signupForm && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t("password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    placeholder={t("placeholders.passwordMin", { min: PASSWORD_MIN_LENGTH })}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    placeholder={t("placeholders.confirmPassword")}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
              <PasswordStrengthMeter password={password} email={email} />
              {confirmPassword.length > 0 && (
                <p
                  className={cn(
                    "text-xs",
                    password === confirmPassword ? "text-success" : "text-danger"
                  )}
                >
                  {password === confirmPassword
                    ? t("passwordsMatch")
                    : t("errors.passwordsDontMatch")}
                </p>
              )}
            </div>
          )}

          {birthDateError && signupForm && (
            <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
              {t(birthDateError)}
            </div>
          )}

          {passwordError && signupForm && (
            <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
              {t(passwordError, { min: PASSWORD_MIN_LENGTH })}
            </div>
          )}

          {signupForm && (
            <div className="space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked);
                    if (e.target.checked) setConsentError(false);
                  }}
                  className="mt-0.5 rounded border-border"
                />
                {/* Links sit on the same line as the label: the consent
                    block is three rows and every extra line is height. */}
                <div className="flex-1 min-w-0 text-xs leading-snug text-text">
                  {t("consent.label")}{" "}
                  <button
                    type="button"
                    onClick={() => openExternal(LEGAL_URLS.terms)}
                    className="text-primary underline hover:text-primary/80"
                  >
                    {t("consent.terms")}
                  </button>
                  <span className="text-text-secondary"> · </span>
                  <button
                    type="button"
                    onClick={() => openExternal(LEGAL_URLS.privacy)}
                    className="text-primary underline hover:text-primary/80"
                  >
                    {t("consent.privacy")}
                  </button>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 rounded border-border"
                />
                <span className="flex-1 min-w-0 text-xs leading-snug text-text-secondary">
                  {t("consent.marketing")}
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={analyticsOptIn}
                  onChange={(e) => setAnalyticsOptIn(e.target.checked)}
                  className="mt-0.5 rounded border-border"
                />
                <span className="flex-1 min-w-0 text-xs leading-snug text-text-secondary">
                  {t("consent.analytics")}
                </span>
              </label>

              {consentError && (
                <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
                  {t("consent.required")}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-sm text-danger bg-danger-light px-3 py-2 rounded-md">
              {error}
            </div>
          )}

          {/* Signup succeeded but the account needs email confirmation —
              no token was issued, so stay on this form and tell the user
              to check their inbox, then sign in. */}
          {confirmationMessage !== null && (
            <div className="text-sm text-info bg-info/10 px-3 py-2 rounded-md">
              {confirmationMessage || t("confirmationSent")}
            </div>
          )}

          <Button type="submit" disabled={loading || checkingCode} className="w-full">
            {gateOpen
              ? checkingCode
                ? t("invite.checking")
                : t("invite.continue")
              : loading
                ? t("signingIn")
                : isSignup
                  ? t("createAccount")
                  : t("signIn")}
          </Button>
        </form>

        <Button
          variant="ghost"
          className="w-full mt-4 text-primary hover:text-primary/80"
          onClick={() => {
            setIsSignup(!isSignup);
            setConsentError(false);
            setBirthDateError(null);
            setPasswordError(null);
            setConfirmPassword("");
            setCodeError("");
            useAuthStore.setState({ error: null, errorCode: null, confirmationMessage: null });
          }}
        >
          {isSignup
            ? `${t("alreadyHaveAccount")} ${t("signIn")}`
            : `${t("dontHaveAccount")} ${t("signUp")}`}
        </Button>
      </Card>
    </div>
  );
}
