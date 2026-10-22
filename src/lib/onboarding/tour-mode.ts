/**
 * Handshake between the welcome tour and the privacy page.
 *
 * While the tour is on its privacy stop the page renders read-only: the
 * controls are inert, the T1 survey trigger is not fired, and its view event
 * is tagged `view_reason: "tour"` so it stays out of the study's view counts.
 *
 * The `?tour=1` URL alone is not enough: the tour also sets a per-tab flag, so
 * a bookmarked or reloaded tour URL after the tour has ended opens the normal,
 * fully instrumented page.
 */

import { PRIVACY_TOUR_PARAM } from "./steps";

const TOUR_ACTIVE_KEY = "findamine:tour-active";

export function markTourActive(): void {
  try {
    sessionStorage.setItem(TOUR_ACTIVE_KEY, "true");
  } catch {
    // Storage blocked: the privacy page just won't enter tour mode.
  }
}

export function clearTourActive(): void {
  try {
    sessionStorage.removeItem(TOUR_ACTIVE_KEY);
  } catch {
    // Nothing to clear.
  }
}

function tourActive(): boolean {
  try {
    return sessionStorage.getItem(TOUR_ACTIVE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Whether the URL query asks for the tour's read-only privacy view. Pure. */
export function hasPrivacyTourParam(search: string): boolean {
  return new URLSearchParams(search).get(PRIVACY_TOUR_PARAM) === "1";
}

/** Whether the privacy page at `search` should render in tour mode. */
export function isPrivacyTourVisit(search: string): boolean {
  return hasPrivacyTourParam(search) && tourActive();
}
