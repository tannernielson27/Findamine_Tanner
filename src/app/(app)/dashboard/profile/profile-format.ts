/**
 * Profile header copy ("Admin · Joined Sep 2026"). Pure, so it is unit tested.
 */

/** "admin" -> "Admin", "hunt_creator" -> "Hunt creator". */
export function roleLabel(role: string | null | undefined): string {
  const words = (role ?? "").trim().replace(/[_-]+/g, " ").toLowerCase();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "Joined Sep 2026"; "" for a missing or unparseable date. */
export function joinedLabel(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `Joined ${new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone }).format(date)}`;
}

/** The header line under the name, skipping whichever part is missing. */
export function profileSubtitle(role: string | null | undefined, createdAt: string | null | undefined, timeZone?: string): string {
  return [roleLabel(role), joinedLabel(createdAt, timeZone)].filter(Boolean).join(" · ");
}
