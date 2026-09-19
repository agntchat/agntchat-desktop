/**
 * Signup password policy and strength scoring.
 *
 * Copied verbatim into all three clients (`web/src/lib`, `desktop/src/lib`,
 * `mobile/lib`) so the meter, the inline rules and the submit gate agree
 * everywhere. Dependency-free and deterministic on purpose: the button never
 * disables without the rule list already saying why.
 *
 * The floor is the client's own — Supabase (GoTrue) mints the account and
 * enforces only its own shorter minimum, so anything we want beyond that has
 * to be checked here. The server-rendered reset page
 * (`password_reset_controller.ex`) enforces the same minimum length.
 */

/** Hard minimum. Also the `{{min}}` the catalog strings interpolate. */
export const PASSWORD_MIN_LENGTH = 8;

/** Length past which a rule-satisfying password counts as strong. */
const LONG_PASSWORD_LENGTH = 12;

/** Rule ids double as catalog keys: `auth:passwordRules.<id>`. */
export type PasswordRuleId = "length" | "case" | "number" | "symbol";

export const PASSWORD_RULE_IDS: readonly PasswordRuleId[] = [
  "length",
  "case",
  "number",
  "symbol",
];

/**
 * The rules the form actually gates on. A symbol is not required — it only
 * lifts the meter — so the checklist the user sees is exactly what blocks
 * them, with nothing implied.
 */
export const PASSWORD_REQUIRED_RULE_IDS: readonly PasswordRuleId[] = [
  "length",
  "case",
  "number",
];

export type PasswordStrengthLevel = "weak" | "fair" | "good" | "strong";

/** Why a password is rejected no matter how its characters are arranged. */
export type PasswordProblem = "common" | "email";

export interface PasswordAssessment {
  /** 0 (empty) … 4 (strong) — the number of filled meter segments. */
  score: 0 | 1 | 2 | 3 | 4;
  level: PasswordStrengthLevel;
  met: Record<PasswordRuleId, boolean>;
  /** Rules still to satisfy, in display order (required or not). */
  unmet: PasswordRuleId[];
  problem: PasswordProblem | null;
  /** The submit gate: every required rule met and no `problem`. */
  acceptable: boolean;
}

// Guessable in the first handful of attempts. Not a dictionary — just the
// shapes people actually reach for when a form demands eight characters.
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "passw0rd",
  "p@ssw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "qazwsxedc",
  "iloveyou",
  "letmein1",
  "letmein123",
  "welcome1",
  "welcome123",
  "admin123",
  "administrator",
  "abc12345",
  "football",
  "baseball",
  "sunshine",
  "princess",
  "monkey123",
  "trustno1",
  "dragon123",
  "superman",
  "starwars",
  "whatever",
  "computer",
  "internet",
  "freedom1",
  "changeme",
  "secret123",
  "testtest",
  "test1234",
  "agntchat",
  "agntchat1",
  "agentchat",
]);

/** "aaaaaaaa" and friends. */
function isSingleCharacter(value: string): boolean {
  return value.length > 0 && new Set(value).size === 1;
}

/** "12345678", "abcdefgh", "87654321". */
function isRunOfCharacters(value: string): boolean {
  if (value.length < 4) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i++) {
    const step = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

function levelForScore(score: number): PasswordStrengthLevel {
  if (score >= 4) return "strong";
  if (score === 3) return "good";
  if (score === 2) return "fair";
  return "weak";
}

/**
 * Score a candidate password. `email` is optional — when given, a password
 * built out of the address's local part is called out rather than silently
 * scored as fine.
 */
export function assessPassword(password: string, email?: string): PasswordAssessment {
  const met: Record<PasswordRuleId, boolean> = {
    length: password.length >= PASSWORD_MIN_LENGTH,
    case: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const unmet = PASSWORD_RULE_IDS.filter((id) => !met[id]);

  const lowered = password.toLowerCase();
  const localPart = ((email ?? "").split("@")[0] ?? "").trim().toLowerCase();

  let problem: PasswordProblem | null = null;
  if (!password) {
    problem = null;
  } else if (
    COMMON_PASSWORDS.has(lowered) ||
    isSingleCharacter(lowered) ||
    isRunOfCharacters(lowered)
  ) {
    problem = "common";
  } else if (localPart.length >= 4 && lowered.includes(localPart)) {
    problem = "email";
  }

  // One point per rule; a long password that already satisfies three tops
  // out the meter. A password under the floor, or a guessable one, is
  // pinned to "weak" however many character classes it happens to contain.
  let score = PASSWORD_RULE_IDS.reduce((total, id) => (met[id] ? total + 1 : total), 0);
  if (met.length && password.length >= LONG_PASSWORD_LENGTH && score >= 3) score += 1;
  if (!met.length || problem) score = Math.min(score, 1);
  if (!password) score = 0;
  score = Math.max(0, Math.min(4, score));

  const acceptable =
    password.length > 0 && !problem && PASSWORD_REQUIRED_RULE_IDS.every((id) => met[id]);

  return {
    score: score as PasswordAssessment["score"],
    level: levelForScore(score),
    met,
    unmet,
    problem,
    acceptable,
  };
}
