/**
 * Static renders for difficulty (navigation help, issue #15): the creator's
 * picker and settings, the player's summary on the hunt page, and the play
 * screen, which must not draw an aid the level turns off even if the data for
 * it were somehow on the device.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/maps/use-google-maps", () => ({
  useGoogleMaps: () => ({ isLoaded: true, unavailableReason: null }),
}));
vi.mock("@/components/maps/navigate-map", () => ({
  default: (props: { targetLat: number; targetLng: number }) =>
    createElement("div", { "data-testid": "stop-map", "data-target": `${props.targetLat},${props.targetLng}` }),
}));
vi.mock("@/lib/play/use-wake-lock", () => ({ useWakeLock: () => {} }));

import { DifficultyPicker } from "@/components/hunts/difficulty-picker";
import { DifficultySettings } from "@/components/hunts/difficulty-settings";
import { DifficultyBadge, DifficultySummary } from "@/components/hunts/difficulty-badge";
import { PlayScreen } from "@/components/play/play-screen";
import type { PlaySession } from "@/lib/play/use-play-session";
import type { StopFlow } from "@/lib/play/use-stop-flow";
import type { Find, StopStep } from "@/lib/play/play-types";
import type { NavigationHelp } from "@/lib/play/navigation-help";

const noop = () => {};
const asyncNoop = async () => {};
const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("DifficultyPicker", () => {
  it("offers the three levels with a plain line each, and marks the chosen one", () => {
    const html = render(createElement(DifficultyPicker, { name: "difficulty", value: "medium", onChange: noop }));
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain("Difficulty");
    for (const label of ["Easy", "Medium", "Hard"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain("a map with the stop on it, and the hot/cold meter");
    expect(html).toContain("the clue and the hot/cold meter. No map.");
    expect(html).toContain("the clue only");
    expect(html).toMatch(/id="difficulty-medium"[^>]*checked=""/);
    expect(html).not.toMatch(/id="difficulty-easy"[^>]*checked=""/);
  });
});

describe("DifficultySettings", () => {
  const base = { busy: false, onSave: async () => true };

  it("lets the creator choose and save before the hunt is locked", () => {
    const html = render(
      createElement(DifficultySettings, { ...base, metadata: { navigation_help: "hard" }, locked: false, played: false })
    );
    expect(html).toMatch(/id="difficulty-hard"[^>]*checked=""/);
    expect(html).toContain("Save difficulty");
    expect(html).toContain("Locks when the hunt is published or first played");
  });

  it("starts on Easy for a hunt with no setting", () => {
    const html = render(createElement(DifficultySettings, { ...base, metadata: null, locked: false, played: false }));
    expect(html).toMatch(/id="difficulty-easy"[^>]*checked=""/);
  });

  it("is read-only once the hunt has been played, and says to clone", () => {
    const html = render(
      createElement(DifficultySettings, { ...base, metadata: { navigation_help: "medium" }, locked: true, played: true })
    );
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("Save difficulty");
    expect(html).toContain("Medium");
    expect(html).toContain("has been played");
    expect(html).toContain("Clone the hunt");
  });

  it("a published hunt nobody has played says to unpublish instead", () => {
    const html = render(createElement(DifficultySettings, { ...base, metadata: {}, locked: true, played: false }));
    expect(html).not.toContain('type="radio"');
    expect(html).toContain("Easy");
    expect(html).toContain("Unpublish it to change the difficulty");
  });
});

describe("the hunt page tells players the difficulty before they start", () => {
  it.each([
    ["easy", "Easy", "a map showing each stop"],
    ["medium", "Medium", "There is no map"],
    ["hard", "Hard", "no map and no hot/cold meter"],
  ] as const)("%s", (level, label, line) => {
    const html = render(createElement(DifficultySummary, { level }));
    expect(html).toContain(label);
    expect(html).toContain(line);
    // The pill reads as "Difficulty: Hard" to a screen reader.
    expect(render(createElement(DifficultyBadge, { level }))).toMatch(/class="sr-only">Difficulty: <\/span>/);
  });
});

/** A started stop that (wrongly) still carries its place: the screen must not use it. */
const stop: Find = {
  id: "f0",
  sort_order: 0,
  started_at: "2026-11-18T10:05:00.000Z",
  open: true,
  clue_text: "Look for the carillon",
  hot_cold_enabled: true,
  scaffolding_level: null,
  reading_check: null,
  locations: { name: "Centennial Bell Tower", latitude: 40.25, longitude: -111.65, radius_meters: 50, safety_notes: "Mind the cyclists" },
  tasks: null,
  primers: null,
};

function playScreen(level: NavigationHelp, step: StopStep): string {
  const session = {
    finds: [stop],
    currentIndex: 0,
    completedFinds: new Set<string>(),
    huntMeta: {},
    delivery: "fixed_order",
    navigationHelp: level,
    clueBoardOpen: false,
    setClueBoardOpen: noop,
    setCurrentIndex: noop,
  } as unknown as PlaySession;
  const flow = {
    step,
    hotCold: { zone: "warm", color: "#22C55E", label: "Getting warmer!", emoji: "", distanceLabel: "120m" },
    gpsStatus: "active",
    setGpsStatus: noop,
    userPos: { lat: 40.251, lng: -111.651, accuracy: 8 },
    locationConsent: "granted",
    setLocationConsent: noop,
    error: null,
    setError: noop,
    photoCheckIn: null,
    handleCheckIn: asyncNoop,
    handleClueRead: noop,
    handlePhotoCheckIn: asyncNoop,
    cancelPhotoCheckIn: noop,
    handlePreviousFind: noop,
    privacyNotice: null,
    hints: {
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
    },
  } as unknown as StopFlow;
  return render(createElement(PlayScreen, { huntId: "hunt-1", session, flow, overlays: null }));
}

describe("PlayScreen follows the hunt's difficulty", () => {
  it("easy: the map of the stop, the place name, the distance and the meter", () => {
    const html = playScreen("easy", "navigate");
    expect(html).toContain('data-testid="stop-map"');
    expect(html).toContain('data-target="40.25,-111.65"');
    expect(html).toContain("Heading to: Centennial Bell Tower");
    expect(html).toContain("Getting warmer");
    expect(html).toMatch(/rotate\(\d+deg\)/);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("difficulty:");
    expect(html).toContain("I'm here");
  });

  it("medium: the meter and distance, but no map and no direction arrow", () => {
    const html = playScreen("medium", "navigate");
    expect(html).not.toContain("stop-map");
    expect(html).not.toContain("40.25");
    expect(html).not.toMatch(/rotate\(/);
    expect(html).toContain("Getting warmer");
    expect(html).toMatch(/>120<span[^>]*>m<\/span>/);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Look for the carillon");
    expect(html).toContain("Mind the cyclists");
    expect(html).toContain("I'm here");
  });

  it("medium: says there is no map when the clue appears", () => {
    const html = playScreen("medium", "clue");
    expect(html).toContain("Medium difficulty: there's no map on this hunt");
    expect(html).not.toContain("stop-map");
  });

  it("hard: the clue and I'm here only, with no meter, distance, map or meter announcements", () => {
    const html = playScreen("hard", "navigate");
    expect(html).not.toContain("stop-map");
    expect(html).not.toContain("40.25");
    expect(html).not.toContain("Getting warmer");
    expect(html).not.toContain("120");
    expect(html).not.toMatch(/rotate\(/);
    expect(html).not.toContain("bg-proximity-");
    expect(html).not.toContain('aria-live="polite"');
    expect(html).not.toContain("We'll tell you when you arrive");
    expect(html).toContain("Look for the carillon");
    expect(html).toContain("Mind the cyclists");
    expect(html).toContain("I'm here");
    // Read out once (role="status"), so a screen-reader user knows how to arrive.
    expect(html).toMatch(/role="status"[^>]*>.*Hard difficulty: there's no map or hot\/cold meter/);
    expect(html).toContain('tap "I\'m here" when you think you\'ve arrived');
  });
});
