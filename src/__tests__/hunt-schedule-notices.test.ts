import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

/**
 * Issue #14: notices for scheduled hunts. Players in a running scheduled hunt
 * are told when stops open and once before it ends; each notice goes out once
 * however often the job runs; and who gets one depends only on being in the
 * hunt and on their own notification settings.
 */

const h = vi.hoisted(() => ({
  sendEmail: vi.fn<(opts: { to: string; subject: string; html: string }) => Promise<{ success: boolean }>>(async () => ({ success: true })),
}));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return { createSupabaseServiceClient: async () => m.current().client };
});
vi.mock("@/lib/services/email", () => ({ sendEmail: h.sendEmail }));

import { GET as runJob } from "@/app/api/cron/hunt-releases/route";
import { readHuntWindow } from "@/lib/hunts/schedule";
import {
  ENDING_LEAD_MS,
  HUNT_ENDING_TYPE,
  HUNT_RELEASE_TYPE,
  RELEASE_LOOKBACK_MS,
  dueEndingNotice,
  dueReleaseNotice,
  endingMessage,
  huntNoticeHref,
  mayEmail,
  mayNotify,
  noticeEmailHtml,
  releaseMessage,
} from "@/lib/services/hunt-schedule-notices";
import { notificationHref } from "@/lib/services/notification-href";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STARTS = "2026-11-23T16:00:00.000Z";
const ENDS = "2026-12-05T04:00:00.000Z";
const TUESDAY = "2026-11-24T16:00:00.000Z";
const WEDNESDAY = "2026-11-25T16:00:00.000Z";
const window = readHuntWindow({ starts_at: STARTS, ends_at: ENDS })!;
const at = (iso: string, plusMs = 0) => Date.parse(iso) + plusMs;

describe("dueReleaseNotice", () => {
  const releases = [null, TUESDAY, TUESDAY, WEDNESDAY];
  const hourBack = { lookbackMs: HOUR };

  it("is due from the moment of a release, for the stops it opened", () => {
    expect(dueReleaseNotice(window, releases, at(TUESDAY) - 1, hourBack)).toBeNull();
    expect(dueReleaseNotice(window, releases, at(TUESDAY), hourBack)).toEqual({ dueAtMs: at(TUESDAY), stopCount: 2 });
    expect(dueReleaseNotice(window, releases, at(TUESDAY, 30 * 60_000), hourBack)).toEqual({ dueAtMs: at(TUESDAY), stopCount: 2 });
  });

  it("covers the hunt's start: stops with no time of their own open then", () => {
    expect(dueReleaseNotice(window, releases, at(STARTS), hourBack)).toEqual({ dueAtMs: at(STARTS), stopCount: 1 });
  });

  it("looks back more than a day, so a job that runs once a day misses nothing", () => {
    expect(RELEASE_LOOKBACK_MS).toBeGreaterThan(DAY);
    expect(dueReleaseNotice(window, releases, at(WEDNESDAY, 5 * 60_000))).toEqual({ dueAtMs: at(WEDNESDAY), stopCount: 3 });
  });

  it("for one player, counts only what opened since they were last told", () => {
    // Told about Tuesday's release; a day later only Wednesday's stop is new.
    const afterTuesday = { afterMs: at(TUESDAY) };
    expect(dueReleaseNotice(window, releases, at(WEDNESDAY, 5 * 60_000), afterTuesday)).toEqual({ dueAtMs: at(WEDNESDAY), stopCount: 1 });
    // Told about Wednesday's: nothing is new.
    expect(dueReleaseNotice(window, releases, at(WEDNESDAY, 5 * 60_000), { afterMs: at(WEDNESDAY) })).toBeNull();
    // Never told, or joined long ago: everything within the lookback.
    expect(dueReleaseNotice(window, releases, at(WEDNESDAY, 5 * 60_000), { afterMs: null })?.stopCount).toBe(3);
    expect(dueReleaseNotice(window, releases, at(WEDNESDAY, 5 * 60_000), { afterMs: -Infinity })?.stopCount).toBe(3);
  });

  it("is quiet once a release is older than the lookback, before the hunt starts and after it ends", () => {
    expect(dueReleaseNotice(window, releases, at(WEDNESDAY, 3 * DAY))).toBeNull();
    expect(dueReleaseNotice(window, releases, at(STARTS) - 1)).toBeNull();
    expect(dueReleaseNotice(window, [new Date(at(ENDS) - HOUR).toISOString()], at(ENDS))).toBeNull();
  });
});

describe("dueEndingNotice", () => {
  it("is due once, in the last day of the hunt, keyed by its end", () => {
    expect(dueEndingNotice(window, at(ENDS) - ENDING_LEAD_MS - 1)).toBeNull();
    expect(dueEndingNotice(window, at(ENDS) - ENDING_LEAD_MS)).toEqual({ dueAtMs: at(ENDS) });
    expect(dueEndingNotice(window, at(ENDS) - 1)).toEqual({ dueAtMs: at(ENDS) });
    expect(dueEndingNotice(window, at(ENDS))).toBeNull();
  });

  it("is never sent for a hunt no longer than a day: it would arrive as the hunt opens", () => {
    const short = readHuntWindow({ starts_at: STARTS, ends_at: new Date(at(STARTS, 6 * HOUR)).toISOString() })!;
    expect(dueEndingNotice(short, at(STARTS, HOUR))).toBeNull();
  });
});

describe("a player's own settings", () => {
  it("in-app notices follow the mute switch and the muted types", () => {
    expect(mayNotify(null, HUNT_RELEASE_TYPE)).toBe(true);
    expect(mayNotify({ push_enabled: true, disabled_types: [] }, HUNT_RELEASE_TYPE)).toBe(true);
    expect(mayNotify({ push_enabled: false }, HUNT_RELEASE_TYPE)).toBe(false);
    expect(mayNotify({ disabled_types: [HUNT_RELEASE_TYPE] }, HUNT_RELEASE_TYPE)).toBe(false);
    expect(mayNotify({ disabled_types: [HUNT_RELEASE_TYPE] }, HUNT_ENDING_TYPE)).toBe(true);
  });

  it("email is only for players who turned it on", () => {
    expect(mayEmail(null, HUNT_RELEASE_TYPE)).toBe(false);
    expect(mayEmail({ email_enabled: false }, HUNT_RELEASE_TYPE)).toBe(false);
    expect(mayEmail({ email_enabled: true }, HUNT_RELEASE_TYPE)).toBe(true);
    expect(mayEmail({ email_enabled: true, disabled_types: [HUNT_RELEASE_TYPE] }, HUNT_RELEASE_TYPE)).toBe(false);
  });
});

describe("what a notice says and where it goes", () => {
  it("counts the stops and names the hunt", () => {
    expect(releaseMessage("Two weeks of clues", 1).title).toBe("A new stop is open in Two weeks of clues");
    expect(releaseMessage("Two weeks of clues", 3).title).toBe("3 new stops are open in Two weeks of clues");
    expect(endingMessage("Two weeks of clues", window, "America/Denver")).toEqual({
      title: "Two weeks of clues ends soon",
      body: "It closes Fri, Dec 4, 9:00 PM. Finish your open stops before then.",
    });
  });

  it("opens the hunt's play screen from the bell", () => {
    expect(huntNoticeHref("hunt", "h1")).toBe("/play/h1");
    expect(huntNoticeHref(null, null)).toBe("/browse");
    expect(notificationHref({ type: HUNT_RELEASE_TYPE, entity_type: "hunt", entity_id: "h1" })).toBe("/play/h1");
    expect(notificationHref({ type: HUNT_ENDING_TYPE, entity_type: "hunt", entity_id: "h1" })).toBe("/play/h1");
  });

  it("escapes a creator's hunt title in the email", () => {
    const html = noticeEmailHtml(releaseMessage('<img src=x onerror="alert(1)">', 1), "https://example.test/play/h1");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain('href="https://example.test/play/h1"');
  });
});

describe("GET /api/cron/hunt-releases", () => {
  const HUNT = "hunt-1";
  const run = (secret: string | null = "s3cret") =>
    runJob(new NextRequest("http://localhost:3000/api/cron/hunt-releases", { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));
  const playing = (user: string, startedAt: string = STARTS, extra: Row = {}): Row => ({
    id: `s-${user}`, hunt_id: HUNT, user_id: user, status: "active", started_at: startedAt, ...extra,
  });

  function seed(over: { hunts?: Row[]; prefs?: Row[]; sessions?: Row[] } = {}): SupabaseDouble {
    return installDouble(
      {
        hunts: over.hunts ?? [
          { id: HUNT, title: "Two weeks of clues", status: "published", deleted_at: null, metadata: { schedule_timezone: "America/Denver" }, starts_at: STARTS, ends_at: ENDS },
        ],
        finds: [
          { id: "f0", hunt_id: HUNT, deleted_at: null, release_at: null },
          { id: "f1", hunt_id: HUNT, deleted_at: null, release_at: TUESDAY },
          { id: "f2", hunt_id: HUNT, deleted_at: null, release_at: WEDNESDAY },
        ],
        play_sessions: over.sessions ?? [
          playing("ada"),
          playing("bo"),
          playing("cy", STARTS, { status: "completed" }),
          playing("dee", STARTS, { hunt_id: "another-hunt" }),
        ],
        users: ["ada", "bo", "cy", "dee"].map((id) => ({ id, email: `${id}@example.test` })),
        notification_preferences: over.prefs ?? [],
        notifications: [],
        hunt_schedule_notices: [],
      },
      { unique: { hunt_schedule_notices: [["hunt_id", "user_id", "kind", "due_at"]] } }
    );
  }
  const titles = (db: SupabaseDouble, user: string) =>
    db.table("notifications").filter((n) => n.user_id === user).map((n) => n.title);

  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
    h.sendEmail.mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(TUESDAY, 2 * 60_000));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
  });

  it("needs the cron secret", async () => {
    const db = seed();
    for (const secret of [null, "wrong"]) expect((await run(secret)).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await run("s3cret")).status).toBe(401);
    expect(db.table("notifications")).toHaveLength(0);
  });

  it("tells everyone playing the hunt that a stop has opened, linking to the hunt", async () => {
    const db = seed();
    const body = await (await run()).json();
    expect(body).toMatchObject({ hunts_open: 1, sent: 2, failed: 0, stopped_early: false });
    const sent = db.table("notifications");
    // The players in this hunt; not one who finished, nor one in another hunt.
    expect(sent.map((n) => n.user_id).sort()).toEqual(["ada", "bo"]);
    // They joined at the start and saw the first stop then: Tuesday's is the new one.
    expect(sent[0]).toMatchObject({
      type: HUNT_RELEASE_TYPE,
      title: "A new stop is open in Two weeks of clues",
      entity_type: "hunt",
      entity_id: HUNT,
    });
  });

  it("sends each notice once, however often it runs", async () => {
    const db = seed();
    await run();
    expect(await (await run()).json()).toMatchObject({ sent: 0, already: 2 });
    expect(db.table("notifications")).toHaveLength(2);
    // The next release is a new notice.
    vi.setSystemTime(at(WEDNESDAY, 60_000));
    expect(await (await run()).json()).toMatchObject({ sent: 2 });
    expect(db.table("notifications")).toHaveLength(4);
  });

  it("run once a day, it counts each stop once: a stop announced yesterday is not new today", async () => {
    const db = seed();
    // Tuesday's run, five minutes after Tuesday's release.
    vi.setSystemTime(at(TUESDAY, 5 * 60_000));
    await run();
    // Wednesday's run, five minutes after Wednesday's: Tuesday's stop is 24 h 05 min old, inside the lookback.
    vi.setSystemTime(at(WEDNESDAY, 5 * 60_000));
    await run();
    expect(titles(db, "ada")).toEqual(["A new stop is open in Two weeks of clues", "A new stop is open in Two weeks of clues"]);
  });

  it("a missed day is made up in one notice", async () => {
    const db = seed({ sessions: [playing("ada", new Date(at(TUESDAY) - HOUR).toISOString())] });
    vi.setSystemTime(at(WEDNESDAY, 5 * 60_000));
    await run();
    expect(titles(db, "ada")).toEqual(["2 new stops are open in Two weeks of clues"]);
  });

  it("someone who joins after a release is not told about stops that were already open when they joined", async () => {
    const db = seed({ sessions: [playing("ada"), playing("bo", new Date(at(TUESDAY, 60_000)).toISOString())] });
    await run();
    expect(titles(db, "ada")).toHaveLength(1);
    expect(titles(db, "bo")).toEqual([]);
    // The next release is news to both.
    vi.setSystemTime(at(WEDNESDAY, 60_000));
    await run();
    expect(titles(db, "bo")).toEqual(["A new stop is open in Two weeks of clues"]);
  });

  it("respects each player's own settings, and emails only those who asked", async () => {
    const db = seed({
      prefs: [
        { user_id: "ada", push_enabled: true, email_enabled: true, disabled_types: [] },
        { user_id: "bo", push_enabled: true, email_enabled: false, disabled_types: [HUNT_RELEASE_TYPE] },
      ],
    });
    expect(await (await run()).json()).toMatchObject({ sent: 1, muted: 1 });
    expect(db.table("notifications").map((n) => n.user_id)).toEqual(["ada"]);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.sendEmail.mock.calls[0][0]).toMatchObject({ to: "ada@example.test", subject: "A new stop is open in Two weeks of clues" });
    // A muted player is not marked as told, so unmuting works for the next release.
    expect(db.table("hunt_schedule_notices").map((n) => n.user_id)).toEqual(["ada"]);
  });

  it("sends nothing for a hunt when the players' settings can't be read: a mute is never overridden", async () => {
    const db = seed({ prefs: [{ user_id: "bo", push_enabled: false }] });
    const realFrom = db.client.from;
    db.client.from = ((table: string) => {
      if (table === "notification_preferences") throw new Error("connection reset");
      return realFrom(table);
    }) as typeof db.client.from;
    const body = await (await run()).json();
    expect(body).toMatchObject({ sent: 0, failed: 1 });
    expect(db.table("notifications")).toHaveLength(0);
    // Nothing was recorded either, so the next run sends it.
    expect(db.table("hunt_schedule_notices")).toHaveLength(0);
    db.client.from = realFrom;
    expect(await (await run()).json()).toMatchObject({ sent: 1, muted: 1 });
  });

  it("takes the record back when the notification can't be written, so a later run sends it", async () => {
    const db = seed();
    const realFrom = db.client.from;
    let fail = true;
    db.client.from = ((table: string) => {
      const query = realFrom(table);
      if (table === "notifications" && fail) {
        query.insert = (() => Promise.resolve({ data: null, error: { message: "boom" } })) as unknown as typeof query.insert;
      }
      return query;
    }) as typeof db.client.from;
    expect(await (await run()).json()).toMatchObject({ sent: 0, failed: 2 });
    expect(db.table("hunt_schedule_notices")).toHaveLength(0);
    fail = false;
    expect(await (await run()).json()).toMatchObject({ sent: 2, failed: 0 });
  });

  it("warns once in the hunt's last day", async () => {
    const db = seed();
    vi.setSystemTime(at(ENDS) - 20 * HOUR);
    expect(await (await run()).json()).toMatchObject({ sent: 2 });
    expect(db.table("notifications")[0]).toMatchObject({ type: HUNT_ENDING_TYPE, title: "Two weeks of clues ends soon" });
    expect(await (await run()).json()).toMatchObject({ sent: 0, already: 2 });
  });

  it("does nothing for hunts that are not running: not started, ended, unpublished, removed, or unscheduled", async () => {
    const base = { title: "Hunt", status: "published", deleted_at: null, metadata: {}, starts_at: STARTS, ends_at: ENDS };
    const db = seed({
      hunts: [
        { ...base, id: "later", starts_at: new Date(at(TUESDAY, DAY)).toISOString() },
        { ...base, id: "over", ends_at: new Date(at(TUESDAY) - HOUR).toISOString() },
        { ...base, id: "draft", status: "draft" },
        { ...base, id: "gone", deleted_at: TUESDAY },
        { ...base, id: "anytime", starts_at: null, ends_at: null },
      ],
      sessions: ["later", "over", "draft", "gone", "anytime"].map((id) => ({ id: `s-${id}`, hunt_id: id, user_id: "ada", status: "active", started_at: STARTS })),
    });
    expect(await (await run()).json()).toMatchObject({ hunts_open: 0, sent: 0 });
    expect(db.table("notifications")).toHaveLength(0);
  });
});
