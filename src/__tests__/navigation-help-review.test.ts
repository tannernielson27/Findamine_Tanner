/**
 * Difficulty (navigation help, issue #15): the rules added after review.
 * What waits for the arrival on Medium and Hard hunts, the creator's note
 * under the picker, and the challenge sheet while the challenge is fetched.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import {
  NAVIGATION_HELP_CREATOR_NOTE,
  NAVIGATION_HELP_LEVELS,
  hidesPlace,
  inheritNavigationHelp,
  readNavigationHelp,
} from "@/lib/play/navigation-help";
import {
  NOT_ARRIVED_MESSAGE,
  PHOTO_ARRIVAL_MESSAGE,
  assertChallengeReleased,
  assertPlaceHelpReleased,
  clampHintLevel,
  hasArrived,
  isUnconfirmedPhotoArrival,
} from "@/app/api/v1/play/_lib/challenge-access";
import { startedStopView, type StopSource } from "@/app/api/v1/play/_lib/stop-view";
import { ApiError } from "@/lib/utils/api-auth";
import { DifficultyPicker } from "@/components/hunts/difficulty-picker";
import { ChallengeSheet } from "@/components/play/challenge-sheet";
import type { StopFlow } from "@/lib/play/use-stop-flow";
import type { Find } from "@/lib/play/play-types";

const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const ARRIVED = "2026-11-18T10:09:00.000Z";
const started = { arrived_at: null, completed_at: null, metadata: {} };
const arrived = { arrived_at: ARRIVED, completed_at: null, metadata: { arrival_method: "gps_tap" } };
const photoPending = { arrived_at: ARRIVED, completed_at: null, metadata: { arrival_method: "photo", arrival_review: "pending" } };
const photoConfirmed = { arrived_at: ARRIVED, completed_at: null, metadata: { arrival_method: "photo" } };

function status(run: () => void): number | "ok" {
  try {
    run();
    return "ok";
  } catch (error) {
    if (error instanceof ApiError) return error.statusCode;
    throw error;
  }
}

describe("hidesPlace", () => {
  it("is true exactly where there is no map", () => {
    expect(NAVIGATION_HELP_LEVELS.map(hidesPlace)).toEqual([false, true, true]);
  });
});

describe("inheritNavigationHelp with a stored value that is not a level", () => {
  it("does not carry it into the update, so the hunt stays editable", () => {
    const update = { hide_scores: true };
    for (const junk of ["HARD", "legacy", 3, null, true, ["hard"]]) {
      const out = inheritNavigationHelp({ navigation_help: junk }, update);
      expect(out).toBe(update);
      expect(readNavigationHelp(out)).toBe("easy");
    }
  });

  it("still carries a real level", () => {
    expect(inheritNavigationHelp({ navigation_help: "hard" }, { hide_scores: true })).toEqual({
      hide_scores: true,
      navigation_help: "hard",
    });
  });
});

describe("what waits for the arrival", () => {
  it("Easy: nothing waits, the place is on the map already", () => {
    for (const progress of [started, arrived, photoPending]) {
      expect(status(() => assertChallengeReleased("easy", progress))).toBe("ok");
      expect(status(() => assertPlaceHelpReleased("easy", progress))).toBe("ok");
    }
  });

  it.each(["medium", "hard"] as const)("%s: challenge help waits until the arrival is recorded", (level) => {
    expect(status(() => assertChallengeReleased(level, started))).toBe(409);
    expect(status(() => assertChallengeReleased(level, arrived))).toBe("ok");
    // A photo check-in is how a player with no GPS gets to the challenge at all.
    expect(status(() => assertChallengeReleased(level, photoPending))).toBe("ok");
  });

  it.each(["medium", "hard"] as const)("%s: help that names the place also needs a check-in someone can trust", (level) => {
    expect(status(() => assertPlaceHelpReleased(level, started))).toBe(409);
    expect(status(() => assertPlaceHelpReleased(level, arrived))).toBe("ok");
    expect(status(() => assertPlaceHelpReleased(level, photoPending))).toBe(409);
    expect(status(() => assertPlaceHelpReleased(level, photoConfirmed))).toBe("ok");
    // Once the stop is finished the place is shown anyway.
    expect(status(() => assertPlaceHelpReleased(level, { ...photoPending, completed_at: ARRIVED }))).toBe("ok");
  });

  it("says why, without saying anything about the stop", () => {
    try {
      assertPlaceHelpReleased("hard", photoPending);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as ApiError).message).toBe(PHOTO_ARRIVAL_MESSAGE);
    }
    expect(NOT_ARRIVED_MESSAGE).toMatch(/once you've arrived/);
  });

  it("reads arrival and photo state from the row", () => {
    expect(hasArrived(started)).toBe(false);
    expect(hasArrived(arrived)).toBe(true);
    expect(hasArrived({ arrived_at: null, completed_at: ARRIVED })).toBe(true);
    expect(isUnconfirmedPhotoArrival(photoPending)).toBe(true);
    expect(isUnconfirmedPhotoArrival(photoConfirmed)).toBe(false);
    expect(isUnconfirmedPhotoArrival(arrived)).toBe(false);
    expect(isUnconfirmedPhotoArrival({ metadata: null })).toBe(false);
  });
});

describe("clampHintLevel", () => {
  it("keeps whole levels 1 to 4 and turns anything else into a level", () => {
    expect([1, 2, 3, 4].map(clampHintLevel)).toEqual([1, 2, 3, 4]);
    expect(clampHintLevel(0)).toBe(1);
    expect(clampHintLevel(9)).toBe(4);
    expect(clampHintLevel(2.9)).toBe(2);
    for (const junk of ["3", null, undefined, Number.NaN, {}, [2], true]) expect(clampHintLevel(junk)).toBe(1);
  });
});

describe("startedStopView and the challenge", () => {
  const source: StopSource = {
    id: "f0",
    sort_order: 0,
    clue_text: "Look for the carillon",
    hot_cold_enabled: true,
    locations: { name: "Centennial Bell Tower", latitude: 40.25, longitude: -111.65, radius_meters: 50 },
    tasks: { title: "Count the bells", challenge_type: "numeric_entry", content: { question: "How many bells?", correct_answer: "52" } },
    primers: null,
  };
  const view = (navigationHelp: "easy" | "medium" | "hard", state: { arrived: boolean; completed: boolean }) =>
    startedStopView(source, "2026-11-18T10:05:00.000Z", { navigationHelp, ...state });

  it("Easy sends it with the start", () => {
    const stop = view("easy", { arrived: false, completed: false });
    expect(stop.tasks?.title).toBe("Count the bells");
    expect(stop).not.toHaveProperty("challenge_pending");
  });

  it.each(["medium", "hard"] as const)("%s holds it until arrival and says one is waiting", (level) => {
    const before = view(level, { arrived: false, completed: false });
    expect(before.tasks).toBeNull();
    expect(before.challenge_pending).toBe(true);
    expect(JSON.stringify(before)).not.toContain("bells");

    for (const state of [{ arrived: true, completed: false }, { arrived: false, completed: true }]) {
      const after = view(level, state);
      expect(after.tasks?.title).toBe("Count the bells");
      expect(after).not.toHaveProperty("challenge_pending");
      expect(JSON.stringify(after)).not.toContain("52");
    }
  });

  it("a stop without a challenge never claims one is waiting", () => {
    const stop = startedStopView({ ...source, tasks: null }, "2026-11-18T10:05:00.000Z", {
      navigationHelp: "hard",
      arrived: false,
      completed: false,
    });
    expect(stop.tasks).toBeNull();
    expect(stop).not.toHaveProperty("challenge_pending");
  });
});

describe("DifficultyPicker's note to the creator", () => {
  const picker = (value: "easy" | "medium" | "hard") =>
    render(createElement(DifficultyPicker, { name: "difficulty", value, onChange: () => {} }));

  it("warns on Medium and Hard that their own words can give the place away", () => {
    for (const level of ["medium", "hard"] as const) expect(picker(level)).toContain(NAVIGATION_HELP_CREATOR_NOTE);
    expect(NAVIGATION_HELP_CREATOR_NOTE).toMatch(/clue, clue hint, primer or safety note/);
  });

  it("says nothing on Easy, where the place is shown", () => {
    expect(picker("easy")).not.toContain(NAVIGATION_HELP_CREATOR_NOTE);
  });
});

describe("ChallengeSheet while the challenge is on its way", () => {
  const find = (over: Partial<Find>): Find => ({
    id: "f0",
    sort_order: 0,
    started_at: "2026-11-18T10:05:00.000Z",
    open: true,
    clue_text: "Look for the carillon",
    hot_cold_enabled: false,
    scaffolding_level: null,
    reading_check: null,
    locations: null,
    tasks: null,
    primers: null,
    ...over,
  });
  const flow = {
    hints: { hintText: "", hintLevel: 0, hintRated: false, requestHint: async () => {}, rateHint: async () => {} },
    feedback: null,
    canRetry: false,
    answer: "",
    setAnswer: () => {},
    handleSubmitAnswer: async () => {},
    submitting: false,
    loadChallenge: async () => {},
  } as unknown as StopFlow;
  const sheet = (stop: Find) => render(createElement(ChallengeSheet, { huntId: "hunt-1", stopNumber: 2, find: stop, flow }));

  it("shows a loading line and a retry, and no answer box for a question the player can't see", () => {
    const html = sheet(find({ challenge_pending: true }));
    expect(html).toContain("Loading your challenge");
    expect(html).toContain("Try again");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Need a hint?");
  });

  it("shows the challenge once it has arrived", () => {
    const html = sheet(
      find({ tasks: { title: "Count the bells", challenge_type: "numeric_entry", content: { question: "How many bells?" } } })
    );
    expect(html).toContain("How many bells?");
    expect(html).toContain("Need a hint?");
    expect(html).not.toContain("Loading your challenge");
  });
});
