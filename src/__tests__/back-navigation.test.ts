/**
 * The Back control (issue #9): the in-app history record it relies on, what it
 * does when there is and is not somewhere to go back to, and that the pages
 * that would otherwise be dead ends carry it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/",
  redirect: () => {},
}));

import {
  BACK_STUCK_AFTER_MS,
  MAX_BACK_STEPS,
  REPLACEMENT_WINDOW_MS,
  goBack,
  hasBackEntry,
  hasInAppBackEntry,
  noteNavigation,
  noteTraversal,
  recordNavigation,
  recordReplacement,
  recordTraversal,
  resetInAppHistory,
  startHistory,
  type BackWindow,
} from "@/lib/navigation/in-app-history";
import { BackButton } from "@/components/ui/back-button";
import PrivacyPolicyPage from "@/app/privacy/page";
import TermsOfUsePage from "@/app/terms/page";
import ConsentVerifiedPage from "@/app/consent-verified/page";
import StudyPage from "@/app/(app)/settings/study/page";
import BlockedPlayersPage from "@/app/(app)/settings/blocked/page";
import PrivacySettingsPage from "@/app/(app)/settings/privacy/page";
import AdminStandardsPage from "@/app/(app)/admin/standards/page";
import { CodenameForm } from "@/components/play/play-states";

/** The Back control as rendered: a link to `fallback` whose text is "Back". */
function backLinkTo(fallback: string): RegExp {
  const href = fallback.replace(/[/.]/g, "\\$&");
  return new RegExp(`<a[^>]*href="${href}"[^>]*>(?:<svg[^>]*>.*?</svg>)?Back</a>`);
}

describe("in-app history record", () => {
  it("starts with one page and nothing behind it", () => {
    const h = startHistory("/privacy");
    expect(h).toEqual({ entries: ["/privacy"], index: 0 });
    expect(hasBackEntry(h)).toBe(false);
    expect(hasBackEntry(null)).toBe(false);
  });

  it("adds a page on a forward navigation and ignores a repeat of the current page", () => {
    const h = recordNavigation(startHistory("/settings"), "/privacy");
    expect(h).toEqual({ entries: ["/settings", "/privacy"], index: 1 });
    expect(hasBackEntry(h)).toBe(true);
    expect(recordNavigation(h, "/privacy")).toBe(h);
  });

  it("drops forward entries when navigating after going back", () => {
    let h = recordNavigation(recordNavigation(startHistory("/a"), "/b"), "/c");
    h = recordTraversal(h, "/b");
    h = recordNavigation(h, "/d");
    expect(h).toEqual({ entries: ["/a", "/b", "/d"], index: 2 });
  });

  it("replaces the current page without adding one", () => {
    const h = recordReplacement(recordNavigation(startHistory("/a"), "/b"), "/c");
    expect(h).toEqual({ entries: ["/a", "/c"], index: 1 });
    expect(recordReplacement(startHistory("/a"), "/b")).toEqual({ entries: ["/b"], index: 0 });
  });

  it("follows back and forward moves", () => {
    const h = recordNavigation(recordNavigation(startHistory("/a"), "/b"), "/c");
    const back = recordTraversal(h, "/b");
    expect(back.index).toBe(1);
    expect(recordTraversal(back, "/c").index).toBe(2);
    expect(recordTraversal(back, "/a").index).toBe(0);
  });

  it("prefers the earlier entry when back and forward lead to the same page", () => {
    // /a -> /b -> /a, then back to /b. A move to /a could be either neighbour.
    let h = recordNavigation(recordNavigation(startHistory("/a"), "/b"), "/a");
    h = recordTraversal(h, "/b");
    expect(recordTraversal(h, "/a").index).toBe(0);
  });

  it("starts over when a move lands on a page that is not on record", () => {
    const h = recordNavigation(startHistory("/a"), "/b");
    expect(recordTraversal(h, "/elsewhere")).toEqual({ entries: ["/elsewhere"], index: 0 });
  });

  it("does not mutate the history it is given", () => {
    const h = recordNavigation(startHistory("/a"), "/b");
    const snapshot = JSON.stringify(h);
    recordNavigation(h, "/c");
    recordReplacement(h, "/c");
    recordTraversal(h, "/a");
    expect(JSON.stringify(h)).toBe(snapshot);
  });
});

/**
 * A stand-in for the browser: a real history stack (paths with optional
 * #anchors), `back()` that moves asynchronously like the real one, and the
 * same popstate bookkeeping the tracker component does.
 */
function fakeBrowser(entries: string[]) {
  const stack = [...entries];
  let index = stack.length - 1;
  const listeners: Record<string, Set<() => void>> = { popstate: new Set(), pagehide: new Set() };
  const pathOf = (url: string) => url.split("#")[0];
  const win: BackWindow = {
    location: {
      get pathname() {
        return pathOf(stack[index]);
      },
    },
    history: {
      back: () => {
        if (index === 0) return; // nothing behind: a real browser does nothing
        setTimeout(() => {
          index -= 1;
          noteTraversal(win.location.pathname);
          for (const listener of [...listeners.popstate]) listener();
        }, 5);
      },
    },
    addEventListener: (type, listener) => listeners[type].add(listener),
    removeEventListener: (type, listener) => listeners[type].delete(listener),
  };
  return {
    win,
    url: () => stack[index],
    listenerCount: () => listeners.popstate.size + listeners.pagehide.size,
  };
}

describe("goBack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetInAppHistory();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetInAppHistory();
  });

  it("goes to the fallback when nothing in the app is behind this page (deep link, cold start)", () => {
    noteNavigation("/privacy");
    const browser = fakeBrowser(["/privacy"]);
    const replace = vi.fn();
    const back = vi.spyOn(browser.win.history, "back");

    goBack({ fallbackHref: "/", replace, win: browser.win });

    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    expect(back).not.toHaveBeenCalled();
  });

  it("goes to the fallback when no page has been recorded at all", () => {
    const browser = fakeBrowser(["/privacy"]);
    const replace = vi.fn();
    goBack({ fallbackHref: "/", replace, win: browser.win });
    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("records the fallback as replacing the page, so the fallback's own Back is not a loop", () => {
    noteNavigation("/admin/standards");
    const browser = fakeBrowser(["/admin/standards"]);
    goBack({ fallbackHref: "/admin", replace: () => noteNavigation("/admin"), win: browser.win });
    expect(hasInAppBackEntry()).toBe(false);
  });

  it("stops expecting the fallback if it never arrives, so a later navigation still counts", () => {
    noteNavigation("/privacy");
    const browser = fakeBrowser(["/privacy"]);
    goBack({ fallbackHref: "/", replace: () => {}, win: browser.win }); // the replace never lands
    vi.advanceTimersByTime(REPLACEMENT_WINDOW_MS + 1);
    noteNavigation("/terms");
    expect(hasInAppBackEntry()).toBe(true);
  });

  it("returns to the page the player came from", () => {
    noteNavigation("/settings");
    noteNavigation("/privacy");
    const browser = fakeBrowser(["/settings", "/privacy"]);
    const replace = vi.fn();

    goBack({ fallbackHref: "/", replace, win: browser.win });
    vi.advanceTimersByTime(BACK_STUCK_AFTER_MS * 3);

    expect(browser.url()).toBe("/settings");
    expect(replace).not.toHaveBeenCalled();
    expect(browser.listenerCount()).toBe(0);
    expect(hasInAppBackEntry()).toBe(false);
  });

  it("steps over in-page anchor entries so one tap leaves the page", () => {
    noteNavigation("/register");
    noteNavigation("/privacy");
    const browser = fakeBrowser(["/register", "/privacy", "/privacy#collect", "/privacy#research"]);
    const replace = vi.fn();

    goBack({ fallbackHref: "/", replace, win: browser.win });
    vi.advanceTimersByTime(BACK_STUCK_AFTER_MS * 3);

    expect(browser.url()).toBe("/register");
    expect(replace).not.toHaveBeenCalled();
  });

  it("falls back instead of doing nothing when the browser has nowhere to go", () => {
    // The record says /settings is behind, but the browser disagrees.
    noteNavigation("/settings");
    noteNavigation("/privacy");
    const browser = fakeBrowser(["/privacy"]);
    const replace = vi.fn();

    goBack({ fallbackHref: "/", replace, win: browser.win });
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BACK_STUCK_AFTER_MS);

    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    expect(browser.listenerCount()).toBe(0);
    expect(hasInAppBackEntry()).toBe(false);
  });

  it("falls back when history runs out of entries for this page before leaving it", () => {
    noteNavigation("/settings");
    noteNavigation("/privacy");
    const browser = fakeBrowser(["/privacy", "/privacy#collect"]);
    const replace = vi.fn();

    goBack({ fallbackHref: "/", replace, win: browser.win });
    vi.advanceTimersByTime(BACK_STUCK_AFTER_MS * 3);

    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("gives up on an endless run of anchor entries", () => {
    noteNavigation("/settings");
    noteNavigation("/privacy");
    const anchors = Array.from({ length: MAX_BACK_STEPS + 5 }, (_, i) => `/privacy#s${i}`);
    const browser = fakeBrowser(["/settings", "/privacy", ...anchors]);
    const replace = vi.fn();

    goBack({ fallbackHref: "/", replace, win: browser.win });
    vi.advanceTimersByTime(BACK_STUCK_AFTER_MS * 3);

    expect(replace).toHaveBeenCalledExactlyOnceWith("/");
    expect(browser.listenerCount()).toBe(0);
  });

  it("ignores a second tap while the first is still in flight", () => {
    noteNavigation("/a");
    noteNavigation("/b");
    noteNavigation("/c");
    const browser = fakeBrowser(["/a", "/b", "/c"]);
    const replace = vi.fn();

    goBack({ fallbackHref: "/", replace, win: browser.win });
    goBack({ fallbackHref: "/", replace, win: browser.win });
    vi.advanceTimersByTime(BACK_STUCK_AFTER_MS * 3);

    expect(browser.url()).toBe("/b");
    expect(replace).not.toHaveBeenCalled();
  });

  it("stops waiting when the browser leaves for an earlier document", () => {
    noteNavigation("/a");
    noteNavigation("/b");
    const listeners = new Map<string, () => void>();
    const replace = vi.fn();
    const win: BackWindow = {
      location: { pathname: "/b" },
      history: { back: () => {} },
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    };

    goBack({ fallbackHref: "/", replace, win });
    listeners.get("pagehide")?.();
    vi.advanceTimersByTime(BACK_STUCK_AFTER_MS * 3);

    expect(replace).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});

describe("BackButton", () => {
  const html = renderToStaticMarkup(createElement(BackButton, { fallbackHref: "/settings" }));

  it("is a link to the fallback route, so it works without scripts", () => {
    expect(html).toMatch(backLinkTo("/settings"));
  });

  it("has a visible text name and hides the arrow from assistive technology", () => {
    expect(html).toContain(">Back</a>");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
  });

  it("has a visible focus state and a 44px tap target", () => {
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("focus-visible:ring-brand");
    expect(html).toContain("min-h-11");
  });

  it("accepts a different label", () => {
    const custom = renderToStaticMarkup(createElement(BackButton, { fallbackHref: "/admin", label: "Back to Admin" }));
    expect(custom).toContain(">Back to Admin</a>");
  });
});

describe("pages that carry the Back control", () => {
  it.each([
    ["privacy policy", PrivacyPolicyPage],
    ["terms of use", TermsOfUsePage],
  ])("%s: before the logo and heading, falling back to the launch route", (_name, Page) => {
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toMatch(backLinkTo("/"));
    expect(html.search(backLinkTo("/"))).toBeLessThan(html.indexOf("<h1"));
    expect(html.search(backLinkTo("/"))).toBeLessThan(html.indexOf("<img"));
  });

  it.each([
    ["confirmed", {}],
    ["already confirmed", { already: "true" }],
    ["failed link", { error: "invalid" }],
  ])("parental consent result (%s)", async (_name, params) => {
    const html = renderToStaticMarkup(await ConsentVerifiedPage({ searchParams: Promise.resolve(params) }));
    expect(html).toMatch(backLinkTo("/"));
  });

  it.each([
    ["research participation", StudyPage],
    ["blocked players", BlockedPlayersPage],
    ["privacy settings", PrivacySettingsPage],
  ])("settings: %s falls back to Settings", (_name, Page) => {
    expect(renderToStaticMarkup(createElement(Page))).toMatch(backLinkTo("/settings"));
  });

  it("admin standards falls back to the Admin home, even while loading", () => {
    expect(renderToStaticMarkup(createElement(AdminStandardsPage))).toMatch(backLinkTo("/admin"));
  });

  it("the explorer-name step before a hunt can be left without starting the hunt", () => {
    const html = renderToStaticMarkup(
      createElement(CodenameForm, { value: "", onChange: () => {}, error: null, onStart: () => {} })
    );
    expect(html).toMatch(backLinkTo("/browse"));
  });
});
