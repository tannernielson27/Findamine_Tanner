/**
 * Haptic feedback for the play loop (@capacitor/haptics).
 *
 * Native app only: on the web every call is a no-op (no navigator.vibrate
 * buzzing in a browser tab). Also off when the player has asked the OS to
 * reduce motion. The plugin is imported lazily after the platform check, so
 * the web build never loads it and needs no `cap sync`.
 *
 * Heat haptics fire only when the hot/cold level changes, never per GPS fix:
 * `hapticForHeatChange` holds that rule and is unit-tested.
 */

import { isNativeApp } from "./platform";

/** Hot/cold zones from the arrive endpoint, cold → hot. */
const HEAT_LEVELS: Record<string, number> = { icy: 1, cold: 2, warm: 3, hot: 4, burning: 5 };

/** Level at which the player counts as "hot" (medium tap instead of light). */
export const HOT_LEVEL = 4;

export type HeatHaptic = "light" | "medium";

/** 1 (icy) … 5 (burning), or null for no reading / an unknown zone. */
export function heatLevel(zone: string | null | undefined): number | null {
  if (!zone) return null;
  return HEAT_LEVELS[zone] ?? null;
}

/**
 * Which tap (if any) a change in heat level earns. Only a rise counts; the
 * first reading of a stop (prev null) is silent, as are repeats and drops.
 */
export function hapticForHeatChange(prev: number | null, next: number | null): HeatHaptic | null {
  if (prev == null || next == null || next <= prev) return null;
  return next >= HOT_LEVEL ? "medium" : "light";
}

function prefersReducedMotion(win?: Window): boolean {
  const w = win ?? (typeof window !== "undefined" ? window : undefined);
  try {
    return !!w?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** True when a haptic would actually be played: native app, motion allowed. */
export function hapticsEnabled(): boolean {
  return isNativeApp() && !prefersReducedMotion();
}

/** Light or medium impact. Never throws. */
export async function hapticImpact(style: HeatHaptic): Promise<void> {
  if (!hapticsEnabled()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: style === "medium" ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch {
    // Plugin missing from an older app build, or the device has no engine.
  }
}

/** Success notification pattern (stop complete). Never throws. */
export async function hapticSuccess(): Promise<void> {
  if (!hapticsEnabled()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // See hapticImpact.
  }
}
