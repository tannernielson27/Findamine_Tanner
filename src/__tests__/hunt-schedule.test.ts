import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  MAX_SCHEDULE_DAYS,
  formatCountdown,
  formatInZone,
  fromWallTime,
  huntPhase,
  isScheduledHunt,
  isStopReleased,
  isTimeZone,
  nextReleaseMs,
  readHuntWindow,
  readScheduleTimeZone,
  releasesFromRule,
  stopReleaseMs,
  toWallTime,
  validateReleaseRule,
  validateSchedule,
  withScheduleTimeZone,
  withoutScheduleTimeZone,
  type ReleaseRule,
} from "@/lib/hunts/schedule";

/** Issue #14: multi-day scheduled hunts. */

const DENVER = "America/Denver";
const iso = (text: string) => Date.parse(text);
// Monday 23 November 2026, 9:00 in Denver (UTC-7) to Friday 4 December, 21:00.
const hunt = { starts_at: "2026-11-23T16:00:00.000Z", ends_at: "2026-12-05T04:00:00.000Z" };
const window = readHuntWindow(hunt)!;

describe("readHuntWindow", () => {
  it("is null for a play-anytime hunt: every hunt made before schedules", () => {
    expect(readHuntWindow(null)).toBeNull();
    expect(readHuntWindow({})).toBeNull();
    expect(readHuntWindow({ starts_at: null, ends_at: null })).toBeNull();
    expect(isScheduledHunt({ starts_at: null, ends_at: null })).toBe(false);
  });

  it("reads a whole window", () => {
    expect(window).toEqual({ startsAtMs: iso(hunt.starts_at), endsAtMs: iso(hunt.ends_at) });
    expect(isScheduledHunt(hunt)).toBe(true);
  });

  it("treats half a window, a backwards one or junk as no window", () => {
    expect(readHuntWindow({ starts_at: hunt.starts_at, ends_at: null })).toBeNull();
    expect(readHuntWindow({ starts_at: hunt.ends_at, ends_at: hunt.starts_at })).toBeNull();
    expect(readHuntWindow({ starts_at: hunt.starts_at, ends_at: hunt.starts_at })).toBeNull();
    expect(readHuntWindow({ starts_at: "soon", ends_at: "later" })).toBeNull();
  });
});

describe("huntPhase", () => {
  it("a hunt with no window can be played any time", () => {
    expect(huntPhase(null, Date.now())).toBe("anytime");
  });

  it("is upcoming before the start, open from the start, ended from the end", () => {
    expect(huntPhase(window, window.startsAtMs - 1)).toBe("upcoming");
    expect(huntPhase(window, window.startsAtMs)).toBe("open");
    expect(huntPhase(window, window.endsAtMs - 1)).toBe("open");
    expect(huntPhase(window, window.endsAtMs)).toBe("ended");
  });
});

describe("stop releases", () => {
  const tuesday = "2026-11-24T16:00:00.000Z";

  it("never hold a stop on a play-anytime hunt", () => {
    expect(stopReleaseMs(null, tuesday)).toBeNull();
    expect(isStopReleased(null, tuesday, 0)).toBe(true);
  });

  it("open a stop at its own time", () => {
    expect(isStopReleased(window, tuesday, iso(tuesday) - 1)).toBe(false);
    expect(isStopReleased(window, tuesday, iso(tuesday))).toBe(true);
  });

  it("open a stop with no time of its own when the hunt starts, never earlier", () => {
    expect(stopReleaseMs(window, null)).toBe(window.startsAtMs);
    expect(isStopReleased(window, null, window.startsAtMs - 1)).toBe(false);
    expect(isStopReleased(window, null, window.startsAtMs)).toBe(true);
    // A release time before the start is held until the start too.
    expect(stopReleaseMs(window, "2026-11-01T00:00:00.000Z")).toBe(window.startsAtMs);
    // Junk reads as "no time of its own".
    expect(stopReleaseMs(window, "whenever")).toBe(window.startsAtMs);
  });

  it("find the next release still to come", () => {
    const releases = [null, tuesday, "2026-11-25T16:00:00.000Z"];
    expect(nextReleaseMs(window, releases, window.startsAtMs - 1)).toBe(window.startsAtMs);
    expect(nextReleaseMs(window, releases, window.startsAtMs)).toBe(iso(tuesday));
    expect(nextReleaseMs(window, releases, iso(tuesday))).toBe(iso("2026-11-25T16:00:00.000Z"));
    expect(nextReleaseMs(window, releases, iso("2026-11-25T16:00:00.000Z"))).toBeNull();
    expect(nextReleaseMs(null, releases, 0)).toBeNull();
  });
});

describe("time zones", () => {
  it("knows real zones from made-up ones", () => {
    expect(isTimeZone(DENVER)).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    for (const bad of ["Mars/Olympus", "", null, 7, "x".repeat(80)]) expect(isTimeZone(bad)).toBe(false);
  });

  it("reads the stored zone, or the default", () => {
    expect(readScheduleTimeZone({ schedule_timezone: "America/New_York" })).toBe("America/New_York");
    expect(readScheduleTimeZone({ schedule_timezone: "Nowhere/Land" })).toBe(DEFAULT_SCHEDULE_TIMEZONE);
    expect(readScheduleTimeZone(null)).toBe(DEFAULT_SCHEDULE_TIMEZONE);
  });

  it("turns a wall time in a zone into the instant, in winter and in summer", () => {
    expect(fromWallTime({ date: "2026-11-23", time: "09:00" }, DENVER)).toBe(iso("2026-11-23T16:00:00.000Z"));
    expect(fromWallTime({ date: "2026-07-01", time: "09:00" }, DENVER)).toBe(iso("2026-07-01T15:00:00.000Z"));
    expect(fromWallTime({ date: "2026-11-23", time: "09:00" }, "UTC")).toBe(iso("2026-11-23T09:00:00.000Z"));
    expect(fromWallTime({ date: "2026-11-23", time: "09:00" }, "Asia/Kolkata")).toBe(iso("2026-11-23T03:30:00.000Z"));
  });

  it("round-trips through toWallTime", () => {
    for (const zone of [DENVER, "UTC", "Asia/Kolkata", "Pacific/Auckland"]) {
      const wall = { date: "2026-12-01", time: "15:45" };
      expect(toWallTime(fromWallTime(wall, zone)!, zone)).toEqual(wall);
    }
    expect(toWallTime(iso("2026-11-23T16:00:00.000Z"), DENVER)).toEqual({ date: "2026-11-23", time: "09:00" });
    // Midnight is 00:00, not 24:00.
    expect(toWallTime(iso("2026-11-23T07:00:00.000Z"), DENVER)).toEqual({ date: "2026-11-23", time: "00:00" });
  });

  it("handles the clock changes: a repeated hour takes the first, a skipped one moves forward", () => {
    // 1 November 2026, 01:30 happens twice in Denver: 07:30Z (MDT) then 08:30Z (MST).
    expect(fromWallTime({ date: "2026-11-01", time: "01:30" }, DENVER)).toBe(iso("2026-11-01T07:30:00.000Z"));
    // 8 March 2026, 02:30 does not exist in Denver.
    expect(fromWallTime({ date: "2026-03-08", time: "02:30" }, DENVER)).toBe(iso("2026-03-08T09:30:00.000Z"));
    // Either side of the change is exact.
    expect(fromWallTime({ date: "2026-03-08", time: "01:30" }, DENVER)).toBe(iso("2026-03-08T08:30:00.000Z"));
    expect(fromWallTime({ date: "2026-03-08", time: "03:30" }, DENVER)).toBe(iso("2026-03-08T09:30:00.000Z"));
  });

  it("refuses text that is not a date or a time", () => {
    for (const wall of [
      { date: "2026-02-31", time: "09:00" },
      { date: "2026-13-01", time: "09:00" },
      { date: "23/11/2026", time: "09:00" },
      { date: "2026-11-23", time: "24:00" },
      { date: "2026-11-23", time: "9am" },
    ]) {
      expect(fromWallTime(wall, DENVER)).toBeNull();
    }
    expect(fromWallTime({ date: "2026-11-23", time: "09:00" }, "Nowhere/Land")).toBeNull();
  });

  it("formats for people", () => {
    expect(formatInZone(iso("2026-11-23T16:00:00.000Z"), DENVER)).toBe("Mon, Nov 23, 9:00 AM");
    expect(formatCountdown(0)).toBe("now");
    expect(formatCountdown(30_000)).toBe("less than a minute");
    expect(formatCountdown(45 * 60_000)).toBe("45 min");
    expect(formatCountdown(3 * 3_600_000)).toBe("3 h");
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe("3 h 12 min");
    expect(formatCountdown(2 * 86_400_000 + 4 * 3_600_000 + 5 * 60_000)).toBe("2 d 4 h");
    expect(formatCountdown(2 * 86_400_000)).toBe("2 d");
  });
});

describe("the rule that fills in release times", () => {
  const rule: ReleaseRule = { firstDate: "2026-11-23", weekdays: [1, 2, 3, 4, 5], times: ["15:00", "09:00"], perRelease: 1 };

  it("gives two clues every weekday at 9:00 and 15:00, starting Monday", () => {
    const releases = releasesFromRule(rule, 5, DENVER).map((ms) => toWallTime(ms, DENVER));
    expect(releases).toEqual([
      { date: "2026-11-23", time: "09:00" },
      { date: "2026-11-23", time: "15:00" },
      { date: "2026-11-24", time: "09:00" },
      { date: "2026-11-24", time: "15:00" },
      { date: "2026-11-25", time: "09:00" },
    ]);
  });

  it("skips the days it isn't told to use", () => {
    // Friday 27 November, then the weekend, then Monday.
    const releases = releasesFromRule({ ...rule, firstDate: "2026-11-27", times: ["09:00"] }, 2, DENVER);
    expect(releases.map((ms) => toWallTime(ms, DENVER).date)).toEqual(["2026-11-27", "2026-11-30"]);
    // A first date that is not one of the weekdays starts on the next one that is.
    const fromSaturday = releasesFromRule({ ...rule, firstDate: "2026-11-28", times: ["09:00"] }, 1, DENVER);
    expect(toWallTime(fromSaturday[0], DENVER).date).toBe("2026-11-30");
  });

  it("opens several stops at once when asked", () => {
    const releases = releasesFromRule({ ...rule, times: ["09:00"], perRelease: 3 }, 7, DENVER);
    expect(releases.map((ms) => toWallTime(ms, DENVER).date)).toEqual([
      "2026-11-23", "2026-11-23", "2026-11-23",
      "2026-11-24", "2026-11-24", "2026-11-24",
      "2026-11-25",
    ]);
  });

  it("keeps the same wall time across a clock change", () => {
    const releases = releasesFromRule(
      { firstDate: "2026-03-06", weekdays: [0, 1, 2, 3, 4, 5, 6], times: ["09:00"], perRelease: 1 },
      4,
      DENVER
    );
    expect(releases.map((ms) => toWallTime(ms, DENVER).time)).toEqual(["09:00", "09:00", "09:00", "09:00"]);
    // 9:00 is 16:00Z before the change on 8 March and 15:00Z after.
    expect(new Date(releases[0]).toISOString()).toBe("2026-03-06T16:00:00.000Z");
    expect(new Date(releases[3]).toISOString()).toBe("2026-03-09T15:00:00.000Z");
  });

  it("returns nothing for a rule that is not valid, and says what is wrong", () => {
    const bad: Array<[Partial<ReleaseRule>, RegExp]> = [
      [{ firstDate: "next week" }, /first release day/],
      [{ weekdays: [] }, /day of the week/],
      [{ weekdays: [7] }, /day of the week/],
      [{ times: [] }, /release times/],
      [{ times: ["9am"] }, /release times/],
      [{ perRelease: 0 }, /stops/],
      [{ perRelease: 2.5 }, /stops/],
    ];
    for (const [change, message] of bad) {
      const broken = { ...rule, ...change };
      const check = validateReleaseRule(broken);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error).toMatch(message);
      expect(releasesFromRule(broken, 3, DENVER)).toEqual([]);
    }
    expect(validateReleaseRule(rule)).toEqual({ ok: true });
    expect(releasesFromRule(rule, 0, DENVER)).toEqual([]);
    expect(releasesFromRule(rule, 3, "Nowhere/Land")).toEqual([]);
  });
});

describe("validateSchedule", () => {
  const findIds = ["a", "b", "c"];
  const good = {
    startsAt: hunt.starts_at,
    endsAt: hunt.ends_at,
    timeZone: DENVER,
    releases: [
      { findId: "a", releaseAt: null },
      { findId: "b", releaseAt: "2026-11-24T16:00:00.000Z" },
      { findId: "c", releaseAt: "2026-11-25T16:00:00.000Z" },
    ],
  };
  const errorOf = (input: typeof good) => {
    const check = validateSchedule(input, findIds);
    return check.ok ? null : check.error;
  };

  it("accepts a window with every stop released inside it", () => {
    expect(errorOf(good)).toBeNull();
  });

  it("needs a window that runs forward and is not absurdly long", () => {
    expect(errorOf({ ...good, startsAt: "" })).toMatch(/starts/);
    expect(errorOf({ ...good, endsAt: "never" })).toMatch(/ends/);
    expect(errorOf({ ...good, endsAt: good.startsAt })).toMatch(/end after it starts/);
    const tooLong = new Date(iso(good.startsAt) + (MAX_SCHEDULE_DAYS + 1) * 86_400_000).toISOString();
    expect(errorOf({ ...good, endsAt: tooLong })).toMatch(/at most 90 days/);
  });

  it("needs a real time zone", () => {
    expect(errorOf({ ...good, timeZone: "Nowhere/Land" })).toMatch(/time zone/);
  });

  it("needs every stop once, released inside the window", () => {
    expect(errorOf({ ...good, releases: good.releases.slice(0, 2) })).toMatch(/every stop/);
    expect(errorOf({ ...good, releases: [...good.releases, { findId: "a", releaseAt: null }] })).toMatch(/twice/);
    expect(errorOf({ ...good, releases: [...good.releases.slice(0, 2), { findId: "zz", releaseAt: null }] })).toMatch(/not in this hunt/);
    const at = (releaseAt: string) => ({ ...good, releases: [good.releases[0], good.releases[1], { findId: "c", releaseAt }] });
    expect(errorOf(at("2026-11-20T16:00:00.000Z"))).toMatch(/before the hunt starts/);
    expect(errorOf(at(good.endsAt))).toMatch(/before the hunt ends/);
    expect(errorOf(at("tomorrow"))).toMatch(/not a valid date/);
  });
});

describe("the schedule's time zone in hunt settings", () => {
  it("is set and removed without touching other settings or the input", () => {
    const before = { hide_scores: true };
    const withZone = withScheduleTimeZone(before, DENVER);
    expect(withZone).toEqual({ hide_scores: true, schedule_timezone: DENVER });
    expect(before).toEqual({ hide_scores: true });
    expect(withoutScheduleTimeZone(withZone)).toEqual({ hide_scores: true });
    expect(withoutScheduleTimeZone(null)).toEqual({});
  });
});
