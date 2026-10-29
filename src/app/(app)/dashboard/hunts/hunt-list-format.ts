/**
 * Labels for the My Hunts list. Pure, so they are unit tested; the status
 * words match Home's "Your hunts" list (components/home/your-hunts.tsx).
 */

export type HuntStatusTone = "juniper" | "sky" | "neutral";

const LIVE_STATUSES = new Set(["published", "enrollment_open", "in_progress"]);

/** "Live", "Ended" or "Draft", with the Tag tone Home uses for each. */
export function huntStatusLabel(status: string | null | undefined): { label: string; tone: HuntStatusTone } {
  if (status && LIVE_STATUSES.has(status)) return { label: "Live", tone: "juniper" };
  if (status === "ended") return { label: "Ended", tone: "sky" };
  return { label: "Draft", tone: "neutral" };
}

const AUDIENCE_LABELS: Record<string, string> = {
  kids: "Kids",
  teens: "Teens",
  adults: "Adults",
  family: "Family",
  all: "All ages",
};

/** "Adults", "All ages"; null when there is no audience to show. */
export function audienceLabel(audience: string | null | undefined): string | null {
  const key = audience?.trim().toLowerCase();
  if (!key) return null;
  return AUDIENCE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/** "1 stop", "5 stops". */
export function stopCountLabel(count: number): string {
  return `${count} ${count === 1 ? "stop" : "stops"}`;
}

/**
 * "Updated Oct 15" this year, "Updated Oct 15, 2025" otherwise; "" for a
 * missing or unparseable date. `timeZone` defaults to the runtime's own.
 */
export function updatedLabel(iso: string | null | undefined, now: Date = new Date(), timeZone?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const yearOf = (d: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(d);
  const sameYear = yearOf(date) === yearOf(now);
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
  }).format(date);
  return `Updated ${day}`;
}
