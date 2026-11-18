/**
 * Static renders for the clue delivery UI: the player's clue board and HUD,
 * and the creator's settings (editable vs locked).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import { ClueBoard } from "@/components/play/clue-board";
import { PlayHud } from "@/components/play/play-hud";
import { ClueDeliverySettings } from "@/components/hunts/clue-delivery-settings";
import { ClueDeliveryBadge } from "@/components/hunts/shuffle-badge";
import { StudyHuntSetting } from "@/components/hunts/study-hunt-setting";
import type { Find } from "@/lib/play/play-types";

describe("StudyHuntSetting", () => {
  const base = { busy: false, onChange: () => {} };

  it("shows admins and researchers a toggle with the explanation", () => {
    const html = renderToStaticMarkup(createElement(StudyHuntSetting, { ...base, studyHunt: false, canSet: true, locked: false }));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Study hunt");
    expect(html).toContain("same stops for every participant");
  });

  it("won't let a locked study hunt be unmarked", () => {
    const html = renderToStaticMarkup(createElement(StudyHuntSetting, { ...base, studyHunt: true, canSet: true, locked: true }));
    expect(html).toMatch(/disabled=""/);
    expect(html).toContain("stays a study hunt");
  });

  it("shows owners the flag read-only, and nothing when it is off", () => {
    const on = renderToStaticMarkup(createElement(StudyHuntSetting, { ...base, studyHunt: true, canSet: false, locked: false }));
    expect(on).toContain("Only admins and researchers can change this");
    expect(on).not.toContain('type="checkbox"');
    expect(renderToStaticMarkup(createElement(StudyHuntSetting, { ...base, studyHunt: false, canSet: false, locked: false }))).toBe("");
  });
});

const noop = () => {};
const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const find = (id: string, clue: string): Find => ({
  id,
  sort_order: 0,
  started_at: "2026-11-18T10:05:00.000Z",
  open: true,
  clue_text: clue,
  hot_cold_enabled: true,
  scaffolding_level: null,
  reading_check: null,
  locations: null,
  tasks: null,
  primers: null,
});
const finds = [find("a", "Under the old oak"), find("b", "Where the water sings"), find("c", "By the red door")];

describe("ClueBoard", () => {
  it("lists only unfinished clues and marks the active one", () => {
    const html = render(
      createElement(ClueBoard, { finds, completedFinds: new Set(["c"]), activeId: "b", onPick: noop, onClose: noop })
    );
    expect(html).toContain("Under the old oak");
    expect(html).toContain("Where the water sings");
    expect(html).not.toContain("By the red door");
    expect(html).toContain("2 open · 1 of 3 found");
    expect(html).toContain("Keep working on this");
    expect(html).toContain('aria-label="Back to the active clue"');
  });

  it("lists a stop that isn't started by number only: its clue is not on the device yet", () => {
    const unstarted: Find = { ...find("b", ""), started_at: null, clue_text: null };
    const html = render(
      createElement(ClueBoard, { finds: [finds[0], unstarted, finds[2]], completedFinds: new Set<string>(), activeId: "a", onPick: noop, onClose: noop })
    );
    expect(html).toContain("Under the old oak");
    expect(html).toContain("Stop 2");
    expect(html).toContain("Not started yet. Its clue appears when you tap I'm ready.");
    expect(html).toContain("Open stop 2");
    expect(html).not.toContain("Where the water sings");
    expect(html).not.toContain("No written clue");
  });

  it("has no close button when there is no open clue to go back to", () => {
    const html = render(createElement(ClueBoard, { finds, completedFinds: new Set<string>(), activeId: null, onPick: noop, onClose: null }));
    expect(html).not.toContain("Back to the active clue");
  });
});

describe("PlayHud with clue delivery", () => {
  const base = { stopNumber: 1, totalStops: 3, completedStops: 1, hint: null, more: { onPrevious: null, reportTargetId: "a", resetKey: "a" } };

  it("shows the all-clues button instead of a stop count", () => {
    const html = render(createElement(PlayHud, { ...base, delivery: "all_at_once", onShowClues: noop }));
    expect(html).toContain("All clues · 1 of 3 found");
    expect(html).not.toContain("Stop 1 of 3");
  });

  it("marks assigned orders, and nothing for the fixed order", () => {
    expect(render(createElement(PlayHud, { ...base, delivery: "assigned_order" }))).toContain("Assigned");
    const fixed = render(createElement(PlayHud, { ...base, delivery: "fixed_order" }));
    expect(fixed).toContain("Stop 1 of 3");
    expect(fixed).not.toContain("Shuffled");
  });
});

describe("ClueDeliveryBadge", () => {
  it("renders nothing for the fixed order", () => {
    expect(render(createElement(ClueDeliveryBadge, { mode: "fixed_order" }))).toBe("");
    expect(render(createElement(ClueDeliveryBadge, { mode: "random_order" }))).toContain("Shuffled");
  });
});

describe("ClueDeliverySettings", () => {
  const stops = [{ id: "a", label: "1. Oak" }, { id: "b", label: "2. Fountain" }];
  const props = { stops, busy: false, onSave: async () => true };

  it("offers the four modes while unlocked", () => {
    const html = render(createElement(ClueDeliverySettings, { ...props, metadata: {}, locked: false }));
    for (const label of ["All at once", "Same order for everyone", "Assigned orders", "Random order"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Save clue delivery");
  });

  it("shows the orders editor for assigned orders", () => {
    const metadata = { clue_delivery: "assigned_order", clue_orders: [["a", "b"], ["b", "a"]] };
    const html = render(createElement(ClueDeliverySettings, { ...props, metadata, locked: false }));
    expect(html).toContain("Order 2");
    expect(html).toContain("Add an order");
  });

  it("is read-only once locked", () => {
    const metadata = { clue_delivery: "assigned_order", clue_orders: [["a", "b"], ["b", "a"]] };
    const html = render(createElement(ClueDeliverySettings, { ...props, metadata, locked: true }));
    expect(html).toContain("Locked because this hunt has been published or played");
    expect(html).toContain("Order 2");
    expect(html).not.toContain("Save clue delivery");
    expect(html).not.toContain("Add an order");
    expect(html).not.toContain('type="radio"');
  });
});
