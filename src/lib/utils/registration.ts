/**
 * Self-registration role rules. Pure, so the age gates are unit tested.
 *
 * - teen:  13 to 17. Under 13 is refused; 18+ becomes an adult player.
 * - adult: 18+. Under 18 is refused (register as a teen instead).
 * - parent / teacher / hunt_creator: no age gate.
 * - anything else falls back to parent (unchanged legacy behavior).
 */

export const SELF_REGISTER_ROLES = ["teen", "adult", "parent", "teacher", "hunt_creator"] as const;
export type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

export type RoleResolution =
  | { ok: true; role: SelfRegisterRole }
  | { ok: false; status: 400 | 403; message: string };

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function ageInYears(dateOfBirth: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(dateOfBirth).getTime()) / YEAR_MS);
}

export function resolveSelfRegisterRole(
  requested: unknown,
  dateOfBirth: string | null | undefined,
  now: number = Date.now()
): RoleResolution {
  const role: SelfRegisterRole = (SELF_REGISTER_ROLES as readonly string[]).includes(requested as string)
    ? (requested as SelfRegisterRole)
    : "parent";

  if (role !== "teen" && role !== "adult") return { ok: true, role };

  if (!dateOfBirth) {
    return { ok: false, status: 400, message: `Date of birth is required for ${role} accounts` };
  }
  const age = ageInYears(dateOfBirth, now);

  if (role === "adult") {
    return age >= 18
      ? { ok: true, role }
      : { ok: false, status: 403, message: "Adult accounts are for players 18 or older. Choose Teen instead." };
  }
  if (age < 13) {
    return {
      ok: false,
      status: 403,
      message:
        "You must be 13 or older to create your own account. Please ask a parent or teacher for help.",
    };
  }
  return { ok: true, role: age >= 18 ? "adult" : "teen" };
}

/** Canonical form for every email we store, look up or rate limit by. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Cheap shape check; the confirmation email is the real validation. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Escape an exact value for a case-insensitive `.ilike()` match, so rows that
 * were stored with mixed case before emails were normalized are still found.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** How far the auth server's clock may trail ours and still count as "now". */
const CREATED_SKEW_MS = 30_000;

/**
 * Whether an auth user was created by the current request rather than being a
 * pre-existing unconfirmed account that generateLink handed back. Only a user
 * this request created may ever be rolled back.
 */
export function wasCreatedDuringRequest(
  createdAt: string | null | undefined,
  requestStartedAt: number
): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && created >= requestStartedAt - CREATED_SKEW_MS;
}