/**
 * Single source for the facts the Privacy Policy and Terms of Use depend on.
 *
 * CONTACT_EMAIL must be a mailbox someone actually reads: Apple reviewers and
 * parents (COPPA requests) use it. Change it here and both pages follow.
 * Bump LAST_UPDATED whenever either policy's wording changes.
 */

export const OPERATOR_NAME = "Findamine";
/** The person legally responsible for the app (the data controller). */
export const OPERATOR_LEGAL_NAME = "Tanner Nielson";
export const SITE_DOMAIN = "findamine.app";
export const CONTACT_EMAIL = "tannernielson27@gmail.com";
/** ISO date (YYYY-MM-DD) the policies were last changed. */
export const LAST_UPDATED = "2026-10-15";

export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";

/** "October 15, 2026" — formatted in UTC so the date never shifts by timezone. */
export function formatLegalDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
