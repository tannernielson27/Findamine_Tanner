/**
 * What the in-app Back control (components/ui/back-button) knows about where
 * the player has been.
 *
 * The browser does not say whether "back" stays inside the app:
 * `history.length` counts other sites and forward entries, and the iOS and
 * Android shells have no back button to fall back on. So the pages visited in
 * this document are recorded here (by components/layout/in-app-history-tracker)
 * and Back only uses browser history when an earlier in-app page is on record.
 * Otherwise (deep link, fresh tab, cold start, reload) it goes to the page's
 * fallback route.
 *
 * Paths only, no query or hash: a filter change or an in-page anchor is not a
 * different page to go back to.
 */

export interface InAppHistory {
  readonly entries: readonly string[];
  /** Position of the current page in `entries`. */
  readonly index: number;
}

export function startHistory(path: string): InAppHistory {
  return { entries: [path], index: 0 };
}

/** A forward navigation (link, router.push): drops any forward entries. */
export function recordNavigation(history: InAppHistory, path: string): InAppHistory {
  if (history.entries[history.index] === path) return history;
  return { entries: [...history.entries.slice(0, history.index + 1), path], index: history.index + 1 };
}

/** A navigation that replaced the current page (router.replace). */
export function recordReplacement(history: InAppHistory, path: string): InAppHistory {
  return { entries: [...history.entries.slice(0, history.index), path], index: history.index };
}

/**
 * A back/forward move (popstate). The browser does not give the direction, so
 * the nearest earlier entry for the path wins: guessing "back" can only
 * under-count, which sends a later Back to the fallback route instead of
 * nowhere. A path that is not on record means the record is wrong; start over.
 */
export function recordTraversal(history: InAppHistory, path: string): InAppHistory {
  if (history.entries[history.index] === path) return history;
  for (let i = history.index - 1; i >= 0; i -= 1) {
    if (history.entries[i] === path) return { entries: history.entries, index: i };
  }
  for (let i = history.index + 1; i < history.entries.length; i += 1) {
    if (history.entries[i] === path) return { entries: history.entries, index: i };
  }
  return startHistory(path);
}

export function hasBackEntry(history: InAppHistory | null): boolean {
  return history !== null && history.index > 0;
}

/* ─── The record for this document ───────────────────────────────────────── */

/**
 * How long after Back starts a fallback replace the next navigation is taken
 * to be that replace. Not matched by path: the fallback may redirect (`/`
 * sends a signed-in player to the app). The limit keeps a replace that never
 * lands from mislabelling some later, unrelated navigation.
 */
export const REPLACEMENT_WINDOW_MS = 10_000;

let current: InAppHistory | null = null;
let replacementExpectedUntil = 0;

export function noteNavigation(path: string): void {
  const replacing = Date.now() <= replacementExpectedUntil;
  replacementExpectedUntil = 0;
  if (!current) {
    current = startHistory(path);
  } else if (replacing) {
    current = recordReplacement(current, path);
  } else {
    current = recordNavigation(current, path);
  }
}

export function noteTraversal(path: string): void {
  current = current ? recordTraversal(current, path) : startHistory(path);
}

/** True when an earlier in-app page is on record for this document. */
export function hasInAppBackEntry(): boolean {
  return hasBackEntry(current);
}

/** Forget everything (tests), or everything except the page being shown. */
export function resetInAppHistory(path?: string): void {
  current = path === undefined ? null : startHistory(path);
  replacementExpectedUntil = 0;
}

/* ─── Going back ─────────────────────────────────────────────────────────── */

/** How long to wait for the browser to move before deciding it will not. */
export const BACK_STUCK_AFTER_MS = 800;
/** In-page anchor entries (a policy's "On this page" links) to step over. */
export const MAX_BACK_STEPS = 30;

/** The parts of `window` used here, so tests can pass a stand-in. */
export interface BackWindow {
  location: { pathname: string };
  history: { back: () => void };
  addEventListener: (type: "popstate" | "pagehide", listener: () => void) => void;
  removeEventListener: (type: "popstate" | "pagehide", listener: () => void) => void;
}

export interface GoBackOptions {
  /** Where to go when there is no earlier in-app page. */
  fallbackHref: string;
  /** Replaces the current page (router.replace). */
  replace: (href: string) => void;
  win?: BackWindow;
}

let leaving = false;

/**
 * Leave the current page: back through browser history when an earlier in-app
 * page is on record, otherwise to `fallbackHref` (replacing this page, as if
 * the player had come from there).
 *
 * History is walked until the path changes, because in-page anchors add
 * entries for the same page. If the browser does not move at all (the record
 * was wrong), the fallback is used, so Back never does nothing.
 */
export function goBack({ fallbackHref, replace, win = window as unknown as BackWindow }: GoBackOptions): void {
  if (leaving) return;

  const goToFallback = () => {
    replacementExpectedUntil = Date.now() + REPLACEMENT_WINDOW_MS;
    replace(fallbackHref);
  };

  if (!hasInAppBackEntry()) {
    goToFallback();
    return;
  }

  const startPath = win.location.pathname;
  let steps = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  leaving = true;

  const stop = () => {
    leaving = false;
    clearTimeout(timer);
    win.removeEventListener("popstate", onPopState);
    win.removeEventListener("pagehide", stop);
  };
  const giveUp = () => {
    stop();
    resetInAppHistory(win.location.pathname);
    goToFallback();
  };
  const step = () => {
    steps += 1;
    clearTimeout(timer);
    timer = setTimeout(giveUp, BACK_STUCK_AFTER_MS);
    win.history.back();
  };
  function onPopState() {
    if (win.location.pathname !== startPath) {
      stop();
    } else if (steps >= MAX_BACK_STEPS) {
      giveUp();
    } else {
      step();
    }
  }

  win.addEventListener("popstate", onPopState);
  // The browser is loading an earlier document: nothing more to do here.
  win.addEventListener("pagehide", stop);
  step();
}
