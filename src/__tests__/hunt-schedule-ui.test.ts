/**
 * Issue #14: the screens for scheduled hunts. The creator's schedule editor
 * and the form logic behind it, the player's clue board (what is open, what
 * is still to come and when), and the dates on the hunt page.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import {
  applyReleaseRule,
  parseTimes,
  scheduleFormFor,
  schedulePreview,
  scheduleRequest,
  timeZoneOptions,
  type ScheduleForm,
} from "@/lib/hunts/schedule-form";
import { readHuntWindow } from "@/lib/hunts/schedule";
import { ScheduleSettings } from "@/components/hunts/schedule-settings";
import { ScheduleSummary, scheduleBlockNote } from "@/components/hunts/schedule-summary";
import { ClueBoard } from "@/components/play/clue-board";
import { DetailCtaBar } from "@/app/(app)/browse/[id]/detail-cta-bar";
import type { Find, PlaySchedule } from "@/lib/play/play-types";

const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const DENVER = "America/Denver";
const HOUR = 3_600_000;
const STARTS = "2026-11-23T16:00:00.000Z"; // Mon 9:00 in Denver
const ENDS = "2026-12-05T04:00:00.000Z"; // Fri 21:00 in Denver
const TUESDAY = "2026-11-24T16:00:00.000Z";
const scheduledHunt = { starts_at: STARTS, ends_at: ENDS, metadata: { schedule_timezone: DENVER } };
const anytimeHunt = { starts_at: null, ends_at: null, metadata: {} };
const stops = [
  { id: "a", label: "1. Bell tower", release_at: null },
  { id: "b", label: "2. Library", release_at: TUESDAY },
  { id: "c", label: "3. Fountain", release_at: TUESDAY },
];
const NOW = Date.parse("2026-11-19T18:00:00.000Z");

describe("scheduleFormFor", () => {
  it("opens a scheduled hunt with its stored times, in the hunt's own zone", () => {
    expect(scheduleFormFor(scheduledHunt, stops, { nowMs: NOW })).toEqual({
      timeZone: DENVER,
      start: { date: "2026-11-23", time: "09:00" },
      end: { date: "2026-12-04", time: "21:00" },
      stops: [
        { findId: "a", wall: null },
        { findId: "b", wall: { date: "2026-11-24", time: "09:00" } },
        { findId: "c", wall: { date: "2026-11-24", time: "09:00" } },
      ],
    });
  });

  it("offers a starting point for a play-anytime hunt: tomorrow at 9:00 for two weeks, in the creator's zone", () => {
    const form = scheduleFormFor(anytimeHunt, stops, { nowMs: NOW, deviceTimeZone: "America/New_York" });
    expect(form).toMatchObject({
      timeZone: "America/New_York",
      start: { date: "2026-11-20", time: "09:00" },
      end: { date: "2026-12-04", time: "21:00" },
    });
    expect(form.stops.every((s) => s.wall === null)).toBe(true);
    // A device zone the runtime doesn't know falls back to the default.
    expect(scheduleFormFor(anytimeHunt, stops, { nowMs: NOW, deviceTimeZone: "Nowhere/Land" }).timeZone).toBe(DENVER);
  });
});

describe("scheduleRequest", () => {
  const form = scheduleFormFor(scheduledHunt, stops, { nowMs: NOW });

  it("turns the form's wall times into the instants the API stores", () => {
    expect(scheduleRequest(form)).toEqual({
      ok: true,
      body: {
        starts_at: STARTS,
        ends_at: ENDS,
        timezone: DENVER,
        releases: [
          { find_id: "a", release_at: null },
          { find_id: "b", release_at: TUESDAY },
          { find_id: "c", release_at: TUESDAY },
        ],
      },
    });
  });

  it("the same wall times in another zone are different instants", () => {
    const eastern = scheduleRequest({ ...form, timeZone: "America/New_York" });
    expect(eastern.ok && eastern.body.starts_at).toBe("2026-11-23T14:00:00.000Z");
  });

  it("says what is wrong instead of producing a request", () => {
    const errorOf = (change: Partial<ScheduleForm>) => {
      const result = scheduleRequest({ ...form, ...change });
      return result.ok ? null : result.error;
    };
    expect(errorOf({ start: { date: "", time: "09:00" } })).toMatch(/hunt starts/);
    expect(errorOf({ end: { date: "2026-12-04", time: "" } })).toMatch(/hunt ends/);
    expect(errorOf({ end: { date: "2026-11-22", time: "09:00" } })).toMatch(/end after it starts/);
    expect(errorOf({ timeZone: "Nowhere/Land" })).toMatch(/time zone/);
    expect(errorOf({ stops: [form.stops[0], { findId: "b", wall: { date: "2026-12-25", time: "09:00" } }, form.stops[2]] })).toMatch(
      /before the hunt ends/
    );
    expect(errorOf({ stops: [form.stops[0], { findId: "b", wall: { date: "", time: "" } }, form.stops[2]] })).toMatch(/stop 2/);
  });
});

describe("applyReleaseRule", () => {
  const form = scheduleFormFor(scheduledHunt, stops, { nowMs: NOW });

  it("fills every stop in from the rule, in stop order, and leaves the form it was given alone", () => {
    const result = applyReleaseRule(form, { firstDate: "2026-11-23", weekdays: [1, 2, 3, 4, 5], times: ["09:00", "15:00"], perRelease: 1 });
    expect(result.ok && result.form.stops.map((s) => s.wall)).toEqual([
      { date: "2026-11-23", time: "09:00" },
      { date: "2026-11-23", time: "15:00" },
      { date: "2026-11-24", time: "09:00" },
    ]);
    expect(form.stops[0].wall).toBeNull();
  });

  it("refuses a rule that makes no sense", () => {
    const result = applyReleaseRule(form, { firstDate: "2026-11-23", weekdays: [], times: ["09:00"], perRelease: 1 });
    expect(result).toEqual({ ok: false, error: "Choose at least one day of the week." });
  });
});

describe("parseTimes", () => {
  it("reads times separated by commas or spaces, and pads the hour", () => {
    expect(parseTimes("09:00, 15:00")).toEqual(["09:00", "15:00"]);
    expect(parseTimes("9:00 15:30")).toEqual(["09:00", "15:30"]);
  });

  it("is null for anything that is not a list of times", () => {
    for (const bad of ["", "9am", "25:00", "09:60", "nine, three"]) expect(parseTimes(bad)).toBeNull();
  });
});

describe("schedulePreview and timeZoneOptions", () => {
  it("lists each release moment in order with the stops it opens", () => {
    expect(schedulePreview(scheduleFormFor(scheduledHunt, stops, { nowMs: NOW }))).toEqual([
      { when: "Mon, Nov 23, 9:00 AM", stopNumbers: [1] },
      { when: "Tue, Nov 24, 9:00 AM", stopNumbers: [2, 3] },
    ]);
  });

  it("puts the hunt's and the device's zones first, without repeats or made-up zones", () => {
    const options = timeZoneOptions("Europe/London", DENVER, "Nowhere/Land", null);
    expect(options.slice(0, 2)).toEqual(["Europe/London", DENVER]);
    expect(options.filter((z) => z === DENVER)).toHaveLength(1);
    expect(options).not.toContain("Nowhere/Land");
  });
});

describe("ScheduleSettings", () => {
  const base = { busy: false, onSave: async () => true, nowMs: NOW, deviceTimeZone: DENVER };

  it("a play-anytime hunt says so and offers to set a schedule", () => {
    const html = render(createElement(ScheduleSettings, { ...base, hunt: anytimeHunt, stops, locked: false }));
    expect(html).toContain("can be played any time");
    expect(html).toContain("Set a schedule");
    expect(html).not.toContain("Save schedule");
  });

  it("can't be scheduled before it has stops", () => {
    const html = render(createElement(ScheduleSettings, { ...base, hunt: anytimeHunt, stops: [], locked: false }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Set a schedule/);
    expect(html).toContain("Add the hunt's stops first");
  });

  it("a scheduled draft shows the window, the zone, each stop's release and the calendar", () => {
    const html = render(createElement(ScheduleSettings, { ...base, hunt: scheduledHunt, stops, locked: false }));
    expect(html).toMatch(/id="schedule-start-date"[^>]*value="2026-11-23"/);
    expect(html).toMatch(/id="schedule-end-time"[^>]*value="21:00"/);
    expect(html).toMatch(/<option value="America\/Denver" selected="">America\/Denver<\/option>/);
    expect(html).toContain("1. Bell tower");
    expect(html).toContain("When the hunt starts");
    expect(html).toMatch(/aria-label="Stop 2 release date"[^>]*value="2026-11-24"/);
    expect(html).toContain("Release calendar");
    expect(html).toContain("Tue, Nov 24, 9:00 AM");
    expect(html).toContain("Stops 2, 3");
    expect(html).toContain("Save schedule");
    expect(html).toContain("Remove the schedule");
    // Tells the creator what else saving changes.
    expect(html).toContain("Saving sets clue");
  });

  it("is read-only once the hunt is published or played", () => {
    const html = render(createElement(ScheduleSettings, { ...base, hunt: scheduledHunt, stops, locked: true }));
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Save schedule");
    expect(html).toContain("Mon, Nov 23, 9:00 AM to Fri, Dec 4, 9:00 PM");
    expect(html).toContain("Stops 2, 3");
    expect(html).toContain("Locked because this hunt has been published or played");
    const anytime = render(createElement(ScheduleSettings, { ...base, hunt: anytimeHunt, stops, locked: true }));
    expect(anytime).toContain("Play any time.");
    expect(anytime).not.toContain("Set a schedule");
  });
});

describe("ClueBoard on a scheduled hunt", () => {
  const find = (id: string, extra: Partial<Find> = {}): Find => ({
    id, sort_order: 0, started_at: null, open: true, clue_text: null, hot_cold_enabled: null, scaffolding_level: null,
    reading_check: null, locations: null, tasks: null, primers: null, ...extra,
  });
  const finds = [
    find("a", { started_at: STARTS, clue_text: "Under the old oak" }),
    find("b"),
    find("c", { open: false, release_at: TUESDAY }),
  ];
  const schedule: PlaySchedule = { starts_at: STARTS, ends_at: ENDS, phase: "open", next_release_at: TUESDAY, server_time: STARTS };
  const board = (extra: Record<string, unknown> = {}) =>
    render(
      createElement(ClueBoard, {
        finds, completedFinds: new Set<string>(), activeId: "a", onPick: () => {}, onClose: () => {},
        schedule, nowMs: Date.parse(TUESDAY) - 20 * HOUR, timeZone: DENVER, ...extra,
      })
    );

  it("lists what is open, and a stop still to come with when it opens and no way to pick it", () => {
    const html = board();
    expect(html).toContain("2 open · 0 of 3 found · 1 still to come.");
    expect(html).toContain("Under the old oak");
    expect(html).toContain("Open stop 2");
    expect(html).toContain("Opens Tue, Nov 24, 9:00 AM");
    expect(html).toContain("in 20 h");
    expect(html).not.toContain("Open stop 3");
    expect(html.match(/<button/g)).toHaveLength(3); // close, keep working on 1, open 2
    expect(html).toContain("Hunt ends Fri, Dec 4, 9:00 PM");
  });

  it("says the player is caught up when everything released is done", () => {
    const html = board({ completedFinds: new Set(["a", "b"]), activeId: null, onClose: null });
    expect(html).toContain("0 open · 2 of 3 found · 1 still to come.");
    expect(html).toContain("You're caught up. Come back when the next stop opens.");
    expect(html).not.toContain("Every clue is found");
  });

  it("once the hunt has ended, offers the results and no stop to play", () => {
    const html = board({ schedule: { ...schedule, phase: "ended", next_release_at: null }, onFinish: () => {}, completedFinds: new Set(["a"]) });
    expect(html).toContain("This hunt has ended");
    expect(html).toContain("You found 1 of 3.");
    expect(html).toContain("See your results");
    expect(html).not.toContain("Open stop");
    expect(html).not.toContain("Back to the active clue");
  });

  it("a hunt with no schedule looks as it did", () => {
    const html = render(
      createElement(ClueBoard, { finds: finds.slice(0, 2), completedFinds: new Set<string>(), activeId: null, onPick: () => {}, onClose: null })
    );
    expect(html).toContain("2 open · 0 of 2 found. Pick one to work on; you can switch any time.");
    expect(html).not.toContain("Hunt ends");
    expect(html).not.toContain("still to come");
  });
});

describe("the hunt page before a player starts", () => {
  const window = readHuntWindow(scheduledHunt)!;

  it("shows the dates in the hunt's zone, names the zone, and says where the hunt is in its run", () => {
    const upcoming = render(createElement(ScheduleSummary, { window, timeZone: DENVER, nowMs: Date.parse(STARTS) - 3 * HOUR }));
    expect(upcoming).toContain("Mon, Nov 23, 9:00 AM to Fri, Dec 4, 9:00 PM");
    expect(upcoming).toContain("America/Denver time");
    expect(upcoming).toContain("Starts in 3 h.");
    expect(upcoming).toContain("you get every stop");
    const open = render(createElement(ScheduleSummary, { window, timeZone: DENVER, nowMs: Date.parse(STARTS) + HOUR }));
    expect(open).toContain("Running now.");
    const ended = render(createElement(ScheduleSummary, { window, timeZone: DENVER, nowMs: Date.parse(ENDS) }));
    expect(ended).toContain("This hunt has ended.");
    expect(ended).not.toContain("Join any time");
  });

  it("gives the start bar a reason only when the hunt can't be started now", () => {
    expect(scheduleBlockNote(window, DENVER, Date.parse(STARTS) - 1)).toBe("This hunt starts Mon, Nov 23, 9:00 AM (America/Denver time).");
    expect(scheduleBlockNote(window, DENVER, Date.parse(STARTS))).toBeNull();
    expect(scheduleBlockNote(window, DENVER, Date.parse(ENDS))).toMatch(/has ended/);
  });

  it("holds Start back until the hunt opens, for players and signed-out visitors alike", () => {
    const bar = (extra: Record<string, unknown>) =>
      render(createElement(DetailCtaBar, { huntId: "h1", status: "published", playable: true, teamHunt: false, signedIn: true, ownerPreview: false, ...extra }));
    const note = "This hunt starts Mon, Nov 23, 9:00 AM (America/Denver time).";
    const waiting = bar({ scheduleNote: note });
    expect(waiting).toContain(note);
    expect(waiting).not.toContain("Start hunt");
    const visitor = bar({ scheduleNote: note, signedIn: false });
    expect(visitor).toContain(note);
    expect(visitor).toContain("Sign in");
    expect(bar({ scheduleNote: null })).toContain("Start hunt");
    expect(bar({})).toContain("Start hunt");
  });
});
