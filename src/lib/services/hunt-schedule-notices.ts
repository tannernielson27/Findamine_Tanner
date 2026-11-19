/**
 * Notices for scheduled hunts (issue #14): "new stops are open" when a
 * release is due, and "ends soon" before the hunt closes.
 *
 * RESEARCH-INTEGRITY GUARDRAIL: who gets a notice depends only on being in
 * the hunt (an active play session) and on the player's own notification
 * preferences. Nothing here reads a privacy condition, a treatment or a
 * profile setting, and nothing may be added that does: notices that differ by
 * condition would confound the study. (Same rule as reengagement.ts.)
 *
 * The decisions are pure, so the job that sends them
 * (app/api/cron/hunt-releases) can run as often or as rarely as it is
 * triggered: each notice is keyed by the moment it is about, and
 * hunt_schedule_notices (migration 087) records it once per player.
 */

import { formatInZone, stopReleaseMs, type HuntWindow } from "@/lib/hunts/schedule";

export const HUNT_RELEASE_TYPE = "hunt_release";
export const HUNT_ENDING_TYPE = "hunt_ending";
export const HUNT_NOTICE_ENTITY = "hunt";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How far back a release still gets a notice. Longer than a day, so a job
 * that only runs daily announces everything since its last run, in one notice.
 */
export const RELEASE_LOOKBACK_MS = 26 * HOUR_MS;
/** How long before the end the "ends soon" notice goes out. */
export const ENDING_LEAD_MS = 24 * HOUR_MS;

export interface ReleaseNotice {
  /** The latest release this notice covers: its key in hunt_schedule_notices. */
  dueAtMs: number;
  /** Stops released within the lookback, up to now. */
  stopCount: number;
}

/**
 * The release notice due for a hunt right now, or null. Only while the hunt
 * is open. Stops that open with the hunt count as a release at its start.
 */
export function dueReleaseNotice(
  window: HuntWindow,
  releases: ReadonlyArray<string | null | undefined>,
  nowMs: number,
  lookbackMs: number = RELEASE_LOOKBACK_MS
): ReleaseNotice | null {
  if (nowMs < window.startsAtMs || nowMs >= window.endsAtMs) return null;
  const due = releases
    .map((r) => stopReleaseMs(window, r))
    .filter((ms): ms is number => ms !== null && ms <= nowMs && ms > nowMs - lookbackMs);
  return due.length > 0 ? { dueAtMs: Math.max(...due), stopCount: due.length } : null;
}

/** The "ends soon" notice due for a hunt right now (keyed by its end), or null. */
export function dueEndingNotice(window: HuntWindow, nowMs: number, leadMs: number = ENDING_LEAD_MS): { dueAtMs: number } | null {
  const left = window.endsAtMs - nowMs;
  // Only for hunts that ran longer than the lead: a one-day hunt needs no "ends soon".
  if (left <= 0 || left > leadMs || window.endsAtMs - window.startsAtMs <= leadMs) return null;
  return nowMs >= window.startsAtMs ? { dueAtMs: window.endsAtMs } : null;
}

export interface NoticePreferences {
  push_enabled?: boolean | null;
  email_enabled?: boolean | null;
  disabled_types?: string[] | null;
}

/** May this player get this kind of notice in the app? Their own settings only. */
export function mayNotify(prefs: NoticePreferences | null | undefined, type: string): boolean {
  if (prefs?.push_enabled === false) return false;
  return !(prefs?.disabled_types ?? []).includes(type);
}

/** Email is opt-in (notification_preferences.email_enabled), and follows the same mute list. */
export function mayEmail(prefs: NoticePreferences | null | undefined, type: string): boolean {
  return prefs?.email_enabled === true && mayNotify(prefs, type);
}

export interface NoticeMessage {
  title: string;
  body: string;
}

export function releaseMessage(huntTitle: string, stopCount: number): NoticeMessage {
  return {
    title: stopCount === 1 ? `A new stop is open in ${huntTitle}` : `${stopCount} new stops are open in ${huntTitle}`,
    body: "Open the hunt to see what's new. The sooner you solve a stop after it opens, the more it can score.",
  };
}

export function endingMessage(huntTitle: string, window: HuntWindow, timeZone: string): NoticeMessage {
  return {
    title: `${huntTitle} ends soon`,
    body: `It closes ${formatInZone(window.endsAtMs, timeZone)}. Finish your open stops before then.`,
  };
}

/** Where tapping a hunt notice goes: the hunt's play screen. */
export function huntNoticeHref(entityType: string | null, entityId: string | null): string {
  return entityType === HUNT_NOTICE_ENTITY && entityId ? `/play/${entityId}` : "/browse";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** A plain email for a notice. Every value is escaped: hunt titles are written by creators. */
export function noticeEmailHtml(message: NoticeMessage, link: string): string {
  return [
    `<p><strong>${escapeHtml(message.title)}</strong></p>`,
    `<p>${escapeHtml(message.body)}</p>`,
    `<p><a href="${escapeHtml(link)}">Open the hunt</a></p>`,
    `<p style="color:#666;font-size:12px">You get these because email notifications are on in your findamine settings.</p>`,
  ].join("\n");
}
