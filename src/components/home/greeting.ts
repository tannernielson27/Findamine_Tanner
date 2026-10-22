/**
 * Home greeting copy. Pure, so it is unit tested and the client can compute
 * it after hydration (the server's clock and time zone are not the player's).
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type DayPart = "morning" | "afternoon" | "evening" | "night";

/** 5–11 morning, 12–16 afternoon, 17–20 evening, otherwise night. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/** "Tuesday afternoon", in the device's local time. */
export function timeOfDayLine(date: Date): string {
  return `${DAYS[date.getDay()]} ${dayPart(date.getHours())}`;
}

/** "Hey, Tanner" or "Hey there" when there is no usable name. */
export function greetingFor(displayName: string | null | undefined): string {
  const name = displayName?.trim();
  return name ? `Hey, ${name}` : "Hey there";
}
