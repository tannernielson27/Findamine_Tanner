/**
 * Client-side data helpers for the privacy settings page. Each one is
 * best-effort: a failure returns an empty/null result so the page still works.
 */

import type { Scheme, SchemeSelectionState } from "@/lib/utils/scheme-selection";

/** Someone a per-person rule can apply to (migration 057). */
export type OverridePerson = { id: string; name: string; kind: "friend" | "minion" };

/** Accepted friends + my crew, the people a per-person rule can target. */
export async function fetchOverridePeople(myId: string): Promise<OverridePerson[]> {
  const found = new Map<string, OverridePerson>();
  try {
    const [fr, rf] = await Promise.all([
      fetch("/api/v1/social/friends").then((r) => (r.ok ? r.json() : { friends: [] })),
      fetch("/api/v1/social/referrals").then((r) => (r.ok ? r.json() : { minions: [] })),
    ]);
    for (const row of fr.friends || []) {
      if (row.status && row.status !== "accepted") continue;
      const other = row.requester?.id === myId ? row.addressee : row.requester;
      if (other?.id && other.id !== myId) {
        found.set(other.id, { id: other.id, name: other.display_name || "A player", kind: "friend" });
      }
    }
    for (const m of rf.minions || []) {
      const u = m.user;
      if (u?.id && !found.has(u.id)) {
        found.set(u.id, { id: u.id, name: u.display_name || "A crew member", kind: "minion" });
      }
    }
  } catch {
    // the list is a convenience; the settings page must still work without it
  }
  return [...found.values()];
}

export interface PendingTriggerDelivery {
  delivery_id: string;
  survey_id: string;
  timepoint: string | null;
}

export interface SurveyGate {
  deliveryId: string;
  timepoint: string;
}

/** The first pending delivery whose timepoint gates Save, in `timepoints` order. Pure. */
export function pickSurveyGate(
  pending: readonly PendingTriggerDelivery[],
  timepoints: readonly string[]
): SurveyGate | null {
  for (const tp of timepoints) {
    const hit = pending.find((p) => p.timepoint === tp);
    if (hit) return { deliveryId: hit.delivery_id, timepoint: tp };
  }
  return null;
}

/**
 * Fire the privacy_view survey trigger (B2) and return the still-answerable
 * delivery that gates Save (T1 before first save, T3 at the end of the study).
 * Non-participants get none.
 */
export async function fetchSurveyGate(timepoints: readonly string[]): Promise<SurveyGate | null> {
  try {
    const res = await fetch("/api/v1/surveys/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "privacy_view" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { pending?: PendingTriggerDelivery[] };
    return pickSurveyGate(data.pending || [], timepoints);
  } catch {
    return null;
  }
}

export interface NormLineData {
  message: string;
  exposureId: string;
}

/** The S5 descriptive norm line (migration 062), or null when none is shown. */
export async function fetchNormLine(context = "settings_privacy"): Promise<NormLineData | null> {
  try {
    const res = await fetch("/api/v1/research/norms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { norm?: { message?: string } | null; exposure_id?: string | null };
    return data.norm?.message && data.exposure_id
      ? { message: data.norm.message, exposureId: data.exposure_id }
      : null;
  } catch {
    return null;
  }
}

export type SchemeChoiceResponse =
  | { ok: true; scheme: Scheme; state: SchemeSelectionState }
  | { ok: false; error: string };

/** POST a scheme preview or switch (S2, migration 060). */
export async function postSchemeChoice(body: Record<string, unknown>): Promise<SchemeChoiceResponse> {
  try {
    const res = await fetch("/api/v1/research/scheme-choice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "Something went wrong. Please try again." };
    return { ok: true, scheme: data.scheme, state: data.state };
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }
}
