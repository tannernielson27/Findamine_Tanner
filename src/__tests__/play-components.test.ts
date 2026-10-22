/**
 * Render-in-isolation checks for the rebuilt play screen. Headless browsers
 * can't start a hunt (bot guard), so these static renders are the sanity
 * check for the new components' structure, copy and states.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import HotColdMeter from "@/components/play/hot-cold-meter";
import { ProximityPanel } from "@/components/play/proximity-panel";
import { MultipleChoice } from "@/components/play/challenge/multiple-choice";
import { ClueCard } from "@/components/play/clue-card";
import { PlayHud } from "@/components/play/play-hud";
import { StopResults } from "@/components/play/stop-results";
import { HuntSummary } from "@/components/play/hunt-summary";
import { PlayEmpty, PlayLoadError } from "@/components/play/play-states";
import { GpsBanners } from "@/components/play/play-banners";
import { SAFETY_REMINDER } from "@/lib/play/safety";
import type { StopHints } from "@/lib/play/use-stop-hints";

function render(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const noop = () => {};
const asyncNoop = async () => {};

const hints: StopHints = {
  clueHintText: "",
  clueHintLevel: 0,
  clueHintTotal: 0,
  clueHintsUnavailable: false,
  canRequestClueHint: true,
  requestClueHint: asyncNoop,
  hintText: "",
  hintLevel: 0,
  hintRated: false,
  requestHint: asyncNoop,
  rateHint: asyncNoop,
  resetHints: noop,
};

describe("HotColdMeter", () => {
  it("draws five proximity steps and a ringed marker at the zone's position", () => {
    const html = render(createElement(HotColdMeter, { level: 4, markerPercent: 70 }));
    for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`bg-proximity-${n}`);
    expect(html).toContain("translateX(70%)");
    expect(html).toContain("border-ink");
    expect(html).not.toContain("fm-burning-pulse");
  });

  it("keeps the burning heartbeat on the marker", () => {
    expect(render(createElement(HotColdMeter, { level: 5, markerPercent: 90 }))).toContain("fm-burning-pulse");
  });
});

describe("ProximityPanel", () => {
  const hotCold = { zone: "warm", color: "#22C55E", label: "Getting warmer!", emoji: "", distanceLabel: "120m" };

  it("shows the distance in big numerals, the plain label and a north-up arrow", () => {
    const html = render(
      createElement(ProximityPanel, {
        hotCold,
        gpsStatus: "active",
        userPos: { lat: 40.25, lng: -111.65 },
        target: { lat: 40.26, lng: -111.64 },
      })
    );
    expect(html).toContain("text-[64px]");
    expect(html).toContain("tabular-nums");
    expect(html).toMatch(/>120<span[^>]*>m<\/span>/);
    expect(html).toContain("Getting warmer");
    expect(html).toMatch(/rotate\(\d+deg\)/);
    expect(html).toContain('aria-live="polite"');
  });

  it("doesn't rotate (fake) an arrow without a position", () => {
    const html = render(createElement(ProximityPanel, { hotCold, gpsStatus: "active", userPos: null, target: null }));
    expect(html).not.toMatch(/rotate\(/);
  });

  it("says it is finding the player while waiting, and stays honest when hot/cold is off", () => {
    expect(render(createElement(ProximityPanel, { hotCold: null, gpsStatus: "waiting", userPos: null, target: null }))).toContain(
      "Finding your location"
    );
    expect(render(createElement(ProximityPanel, { hotCold: null, gpsStatus: "active", userPos: null, target: null }))).toContain(
      "We'll tell you when you arrive"
    );
  });
});

describe("GpsBanners", () => {
  it("is inline and offers a retry when the signal is lost", () => {
    const html = render(createElement(GpsBanners, { gpsStatus: "timeout", accuracy: null, onRetry: noop }));
    expect(html).toContain("Move into open sky");
    expect(html).toContain("Retry");
    expect(html).not.toContain("fixed");
  });

  it("reports rough accuracy in metres", () => {
    expect(render(createElement(GpsBanners, { gpsStatus: "active", accuracy: 41.6, onRetry: noop }))).toContain("GPS ±42 m");
    expect(render(createElement(GpsBanners, { gpsStatus: "active", accuracy: 8, onRetry: noop }))).toBe("");
  });

  it("points to the manual check-in when location is denied", () => {
    expect(render(createElement(GpsBanners, { gpsStatus: "denied", accuracy: null, onRetry: noop }))).toContain(
      "tap I'm here when you reach the stop"
    );
  });
});

describe("MultipleChoice", () => {
  const content = { question: "What year is on the plaque?", options: ["1912", "1927"] };

  it("says what's missing until an answer is picked", () => {
    const html = render(createElement(MultipleChoice, { content, answer: "", onAnswerChange: noop, onSubmit: noop }));
    expect(html).toContain("Pick an answer");
    expect(html).toContain("disabled");
    expect(html).toContain("min-h-[60px]");
    expect(html).toContain('role="radiogroup"');
  });

  it("marks the selected option and enables Submit answer", () => {
    const html = render(createElement(MultipleChoice, { content, answer: "1927", onAnswerChange: noop, onSubmit: noop }));
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Submit answer");
  });

  it("can leave the question to the sheet heading", () => {
    const html = render(
      createElement(MultipleChoice, { content, answer: "", onAnswerChange: noop, onSubmit: noop, showQuestion: false })
    );
    expect(html).not.toContain("<p class=\"mb-3 text-lg text-ink\">What year");
  });
});

describe("ClueCard", () => {
  it("shows the CLUE label, the clue, and the unchanged safety reminder while navigating", () => {
    const html = render(
      createElement(ClueCard, { clue: "Head toward the bell tower.", placeName: null, hints, showSafetyReminder: true })
    );
    expect(html).toContain("CLUE");
    expect(html).toContain("text-on-ink-accent");
    expect(html).toContain("Head toward the bell tower.");
    expect(html).toContain(SAFETY_REMINDER);
  });
});

describe("PlayHud", () => {
  it("has a pause link home, the stop count and a costed hint button", () => {
    const html = render(
      createElement(PlayHud, { stopNumber: 3, totalStops: 7, completedStops: 2, hint: { available: true, onRequest: noop } })
    );
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('aria-label="Pause hunt"');
    expect(html).toContain("Stop 3 of 7");
    expect(html).toContain("costs 2 points");
  });
});

describe("StopResults", () => {
  const base = {
    huntId: "h1",
    findId: "f1",
    stopNumber: 3,
    totalStops: 7,
    completedStops: 3,
    isLastStop: false,
    score: 30,
    hideScores: false,
    feedback: { type: "correct", main: "Nice!", explanation: "The plaque says 1927.", next_steps: "Keep going." },
    breakdown: { correctness: 20, masteryBonus: 5, completion: 5, hintPenalty: 0 },
    alreadyCompleted: true,
    error: null,
    noticeVisible: false,
    uploadingPhoto: false,
    finishing: false,
    onPhoto: asyncNoop,
    onSkipPhoto: noop,
    onNext: noop,
    onFinish: noop,
    onPrevious: noop,
    onDismissError: noop,
    onError: noop,
  };

  it("celebrates on juniper with the server's feedback and the next stop", () => {
    const html = render(createElement(StopResults, { ...base, phase: "feedback" as const }));
    expect(html).toContain("bg-juniper-deep");
    expect(html).toContain("STOP 3 COMPLETE");
    expect(html).toContain("text-[80px]");
    expect(html).toContain("The plaque says 1927.");
    expect(html).toContain("3 of 7 stops done");
    expect(html).toContain("Head to stop 4");
    expect(html).toContain("Take a break");
  });

  it("offers the optional geo-selfie first", () => {
    const html = render(createElement(StopResults, { ...base, phase: "capture" as const }));
    expect(html).toContain("Take a geo-selfie");
    expect(html).toContain("Skip photo");
    expect(html).not.toContain("Head to stop");
  });

  it("finishes the hunt from the last stop, and hides points for anxiety-sensitive hunts", () => {
    const html = render(createElement(StopResults, { ...base, phase: "feedback" as const, isLastStop: true, hideScores: true }));
    expect(html).toContain("Finish hunt");
    expect(html).toContain("Complete!");
    expect(html).not.toContain("text-[80px]");
  });

  it("keeps its buttons clear of the privacy notice toast", () => {
    const html = render(createElement(StopResults, { ...base, phase: "feedback" as const, noticeVisible: true }));
    expect(html).toContain("pb-[calc(152px+env(safe-area-inset-bottom))]");
  });
});

describe("HuntSummary and system states", () => {
  it("ends with Back to Home and a Find another hunt link to /browse", () => {
    const html = render(
      createElement(HuntSummary, {
        summary: { totalScore: 210, findsCompleted: 7, totalFinds: 7, startedAt: "2026-10-21T10:00:00Z", completedAt: "2026-10-21T10:42:00Z" },
        totalStops: 7,
      })
    );
    expect(html).toContain("You finished all 7 stops");
    expect(html).toContain("42m");
    expect(html).toContain('href="/browse"');
    expect(html).toContain("Find another hunt");
  });

  it("a failed start shows the reason and a retry, not 'no stops'", () => {
    const html = render(createElement(PlayLoadError, { message: "Hunt not found or not available", onRetry: noop }));
    expect(html).toContain("We couldn't start this hunt");
    expect(html).toContain("Hunt not found or not available");
    expect(html).toContain("Try again");
    expect(html).not.toContain("no stops");
  });

  it("the empty state explains and gives one action", () => {
    const html = render(createElement(PlayEmpty));
    expect(html).toContain("This hunt has no stops yet");
    expect(html).toContain('href="/browse"');
  });
});
