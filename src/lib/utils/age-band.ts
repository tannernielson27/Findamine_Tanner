import type { AgeBand } from "@/lib/themes/tokens";

const BANDS: readonly AgeBand[] = ["primary", "intermediate", "teen", "adult"];

/**
 * The band to use for a user. A stored band always wins. Without one, children
 * fall back to the ages 10-12 band and teens to teen; everyone else (adults,
 * parents, teachers, staff) gets the adult band, never a kid voice.
 */
export function bandForUser(storedBand: string | null | undefined, role: string | null | undefined): AgeBand {
  if (storedBand && (BANDS as readonly string[]).includes(storedBand)) return storedBand as AgeBand;
  if (role === "child") return "intermediate";
  if (role === "teen") return "teen";
  return "adult";
}
