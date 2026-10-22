import { describe, it, expect } from "vitest";
import {
  isCreatorRole,
  onboardingDestination,
  finalCtaLabel,
  stepsForRole,
  ONBOARDING_MILESTONE,
  PRIVACY_STEP,
  PRIVACY_TOUR_ANCHOR,
  PRIVACY_TOUR_ROUTE,
  clampStep,
  stepsForUser,
  tabAnchor,
} from "@/lib/onboarding/steps";
import { hasPrivacyTourParam } from "@/lib/onboarding/tour-mode";

describe("onboarding role routing", () => {
  it("classifies creator roles", () => {
    expect(isCreatorRole("teacher")).toBe(true);
    expect(isCreatorRole("hunt_creator")).toBe(true);
    expect(isCreatorRole("admin")).toBe(true);
  });

  it("classifies player roles", () => {
    expect(isCreatorRole("teen")).toBe(false);
    expect(isCreatorRole("parent")).toBe(false);
    expect(isCreatorRole("child")).toBe(false);
    expect(isCreatorRole("student")).toBe(false);
  });

  it("treats missing/unknown roles as players (safe default)", () => {
    expect(isCreatorRole(undefined)).toBe(false);
    expect(isCreatorRole(null)).toBe(false);
    expect(isCreatorRole("")).toBe(false);
    expect(isCreatorRole("banana")).toBe(false);
  });

  it("sends players to browse and creators to hunt management", () => {
    expect(onboardingDestination("teen")).toBe("/browse");
    expect(onboardingDestination("teacher")).toBe("/dashboard/hunts");
  });

  it("labels the final CTA per role", () => {
    expect(finalCtaLabel("teen")).toContain("explor");
    expect(finalCtaLabel("teacher")).toContain("Build");
  });
});

describe("onboarding steps", () => {
  it("returns a non-empty, well-formed step list for both audiences", () => {
    for (const role of ["teen", "teacher"]) {
      const steps = stepsForRole(role);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.body.length).toBeGreaterThan(0);
        expect(s.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives creators different content than players", () => {
    expect(stepsForRole("teacher")).not.toEqual(stepsForRole("teen"));
  });

  it("keeps privacy language to the one privacy stop", () => {
    // Only PRIVACY_STEP may talk about privacy; no step names the manipulation.
    for (const role of ["teen", "teacher"]) {
      for (const s of stepsForRole(role)) {
        const text = `${s.title} ${s.body}`.toLowerCase();
        expect(text).not.toMatch(/treatment|condition|study|friction/);
        if (s.id !== PRIVACY_STEP.id) expect(text).not.toMatch(/privacy|visibility/);
      }
    }
  });

  it("shows the privacy screen without directing a change", () => {
    const text = `${PRIVACY_STEP.title} ${PRIVACY_STEP.body}`.toLowerCase();
    expect(text).toContain("privacy");
    expect(text).toContain("don't need to do anything");
    // No nudges either way: protective or permissive.
    expect(text).not.toMatch(/(should|recommend|protect|safe|risk|hide|share more|make sure|change)/);
  });

  it("gives every condition the same privacy stop, opened read-only on the real screen", () => {
    for (const role of ["adult", "teen", "teacher", "hunt_creator", "admin"]) {
      const step = stepsForRole(role).find((s) => s.id === PRIVACY_STEP.id);
      expect(step).toBe(PRIVACY_STEP);
    }
    expect(PRIVACY_STEP.route).toBe(PRIVACY_TOUR_ROUTE);
    expect(hasPrivacyTourParam(new URL(PRIVACY_TOUR_ROUTE, "https://x").search)).toBe(true);
    expect(PRIVACY_STEP.anchor).toBe(PRIVACY_TOUR_ANCHOR);
  });

  it("walks players through every tab, then privacy, then a finish card", () => {
    expect(stepsForRole("adult").map((s) => s.id)).toEqual([
      "welcome", "home", "explore", "play", "ranks", "profile", "privacy", "done",
    ]);
    expect(stepsForRole("teacher").map((s) => s.id)).toEqual([
      "welcome", "home", "explore", "hunts", "profile", "privacy", "done",
    ]);
  });

  it("gives every step a unique id", () => {
    for (const role of ["teen", "teacher"]) {
      const ids = stepsForRole(role).map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("uses the milestone name the API reads", () => {
    expect(ONBOARDING_MILESTONE).toBe("onboarding_completed");
  });
});

describe("stepsForUser", () => {
  it("drops tab steps for tabs the user doesn't have", () => {
    const ids = stepsForUser("adult", ["home", "explore", "profile"]).map((s) => s.id);
    expect(ids).not.toContain("ranks");
    expect(ids).toContain("privacy");
    expect(ids).toContain("play"); // centered card, no tab needed
  });

  it("keeps every step when every tab is present", () => {
    expect(stepsForUser("adult", ["home", "explore", "ranks", "profile"])).toEqual(stepsForRole("adult"));
  });

  it("anchors tab steps with the same key the tab bar renders", () => {
    expect(stepsForRole("adult").find((s) => s.id === "explore")?.anchor).toBe(tabAnchor("explore"));
  });
});

describe("clampStep", () => {
  it("keeps a valid index", () => {
    expect(clampStep(3, 8)).toBe(3);
  });

  it("clamps out-of-range and junk to the tour", () => {
    expect(clampStep(12, 8)).toBe(7);
    expect(clampStep(-1, 8)).toBe(0);
    expect(clampStep(Number.NaN, 8)).toBe(0);
    expect(clampStep(1.5, 8)).toBe(0);
    expect(clampStep(2, 0)).toBe(0);
  });
});

describe("privacy tour param", () => {
  it("only matches tour=1", () => {
    expect(hasPrivacyTourParam("?tour=1")).toBe(true);
    expect(hasPrivacyTourParam("?from=checkin&tour=1")).toBe(true);
    expect(hasPrivacyTourParam("")).toBe(false);
    expect(hasPrivacyTourParam("?tour=0")).toBe(false);
    expect(hasPrivacyTourParam("?from=checkin")).toBe(false);
  });
});
