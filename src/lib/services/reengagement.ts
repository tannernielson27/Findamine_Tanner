/**
 * Re-engagement nudge logic (Workstream B / Task B4).
 *
 * RESEARCH-INTEGRITY GUARDRAIL — READ BEFORE EDITING:
 * Re-engagement nudges MUST be applied UNIFORMLY across all participants and
 * privacy conditions. Differential nudging by condition would confound the
 * experiment. This module enforces that structurally: the decision function
 * takes ONLY engagement signals (inactivity, cooldown, the user's own
 * notification preferences) — it has no access to `privacy_treatment`,
 * `profile_visibility`, or any condition-derived input. Do NOT add a condition
 * parameter or branch on condition here or in the cron that calls it.
 *
 * Pure + deterministic so the uniformity property is unit-testable.
 */

import { PLAYABLE_HUNT_STATUSES } from "@/lib/play/active-hunt-builder";

export const REENGAGEMENT_TYPE = "reengagement";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReengagementConfig {
  /** Days of inactivity before a nudge becomes eligible. */
  inactivityDays: number;
  /** Minimum days between nudges to the same participant. */
  cooldownDays: number;
}

export const DEFAULT_REENGAGEMENT_CONFIG: ReengagementConfig = {
  inactivityDays: 3,
  cooldownDays: 4,
};

export interface ParticipantEngagement {
  /** ISO timestamp the participant was last seen (last activity, or enrollment if never active). */
  lastSeenAt: string | null;
  /** ISO timestamp of the most recent re-engagement nudge, if any. */
  lastNudgeAt: string | null;
  /** The participant's own push setting (uniform opt-out, not condition). */
  pushEnabled: boolean;
  /** The participant's own muted notification types. */
  disabledTypes: string[];
}

export type ReengagementReason =
  | "no_baseline"
  | "still_active"
  | "in_cooldown"
  | "opted_out"
  | "eligible";

export interface ReengagementDecision {
  shouldNudge: boolean;
  reason: ReengagementReason;
  daysInactive: number | null;
}

function daysBetween(laterMs: number, earlierIso: string): number {
  return Math.floor((laterMs - new Date(earlierIso).getTime()) / DAY_MS);
}

/**
 * Decide whether to nudge a participant. Deliberately accepts NO condition input.
 */
export function decideReengagement(
  p: ParticipantEngagement,
  nowMs: number,
  config: ReengagementConfig = DEFAULT_REENGAGEMENT_CONFIG
): ReengagementDecision {
  // Respect the participant's own preference — applied identically to everyone.
  if (!p.pushEnabled || p.disabledTypes.includes(REENGAGEMENT_TYPE)) {
    return { shouldNudge: false, reason: "opted_out", daysInactive: null };
  }

  if (!p.lastSeenAt) {
    return { shouldNudge: false, reason: "no_baseline", daysInactive: null };
  }

  const daysInactive = daysBetween(nowMs, p.lastSeenAt);
  if (daysInactive < config.inactivityDays) {
    return { shouldNudge: false, reason: "still_active", daysInactive };
  }

  if (p.lastNudgeAt && daysBetween(nowMs, p.lastNudgeAt) < config.cooldownDays) {
    return { shouldNudge: false, reason: "in_cooldown", daysInactive };
  }

  return { shouldNudge: true, reason: "eligible", daysInactive };
}

export interface ReengagementMessage {
  title: string;
  body: string;
}

/**
 * Pick the nudge copy. Tiered ONLY by how long the participant has been away —
 * never by condition. Same inactivity → same message for every participant.
 */
export function reengagementMessage(daysInactive: number): ReengagementMessage {
  if (daysInactive >= 7) {
    return {
      title: "We miss you on the trail!",
      body: "Your crew is still out exploring. Pick up where you left off and climb the board.",
    };
  }
  return {
    title: "Your next find is waiting",
    body: "Jump back into a hunt — points and badges are up for grabs.",
  };
}

// ── Where tapping the nudge goes ─────────────────────────────────────────────
// The link is chosen from the participant's OWN play sessions (no condition
// input), so it keeps the uniformity guardrail above. It is stored on the
// notification row as entity_type/entity_id (existing columns, no migration).

/** `notifications.entity_type` for a nudge that resumes a hunt. */
export const REENGAGEMENT_HUNT_ENTITY = "hunt";
/** Where a nudge goes when the player has no hunt in progress. */
export const REENGAGEMENT_FALLBACK_PATH = "/browse";

export interface ResumableHunt {
  id: string;
  status: string;
  deleted_at: string | null;
}

/**
 * The hunt a nudge should open: the first hunt, in most-recent-activity order,
 * that can still be played. `rankedHuntIds` comes from rankSessions over the
 * player's active sessions. Null when none qualifies.
 */
export function pickResumeHuntId(
  rankedHuntIds: readonly string[],
  hunts: readonly ResumableHunt[]
): string | null {
  const byId = new Map(hunts.map((h) => [h.id, h]));
  for (const id of rankedHuntIds) {
    const hunt = byId.get(id);
    if (hunt && !hunt.deleted_at && PLAYABLE_HUNT_STATUSES.includes(hunt.status)) return id;
  }
  return null;
}

export interface ReengagementLink {
  entity_type: string | null;
  entity_id: string | null;
}

/** Columns to store on the nudge row for the chosen hunt (or none → browse). */
export function reengagementLink(huntId: string | null): ReengagementLink {
  return huntId
    ? { entity_type: REENGAGEMENT_HUNT_ENTITY, entity_id: huntId }
    : { entity_type: null, entity_id: null };
}

/** The in-app path a stored nudge opens: the hunt's play map, else browse. */
export function reengagementHref(entityType: string | null, entityId: string | null): string {
  if (entityType === REENGAGEMENT_HUNT_ENTITY && entityId) {
    return `/play/${encodeURIComponent(entityId)}`;
  }
  return REENGAGEMENT_FALLBACK_PATH;
}
