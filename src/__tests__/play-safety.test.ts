import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SAFETY_ACK_AT_META_KEY,
  SAFETY_ACK_META_KEY,
  SAFETY_NOTICE_VERSION,
  SAFETY_REMINDER,
  SAFETY_TIPS,
  MAX_SAFETY_NOTES_LENGTH,
  isSafetyAcknowledged,
  normalizeSafetyNotes,
  safetyAckMetadata,
  safetyAckStorageKey,
} from "@/lib/play/safety";
import { SafetyNotice } from "@/components/play/safety-notice";
import { SafetyReminder, SafetyTipList, StopSafetyNote } from "@/components/play/safety-tips";
import {
  PUBLISH_SAFETY_AFFIRMATION,
  PublishSafetyCheck,
} from "@/components/hunts/publish-safety-check";

/** Static markup with HTML entities decoded, so copy can be matched as written. */
function render(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(el)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

describe("safety acknowledgement logic", () => {
  it("is unacknowledged with no metadata", () => {
    expect(isSafetyAcknowledged(null)).toBe(false);
    expect(isSafetyAcknowledged(undefined)).toBe(false);
    expect(isSafetyAcknowledged({})).toBe(false);
  });

  it("accepts the current or a newer version", () => {
    expect(isSafetyAcknowledged({ [SAFETY_ACK_META_KEY]: SAFETY_NOTICE_VERSION })).toBe(true);
    expect(isSafetyAcknowledged({ [SAFETY_ACK_META_KEY]: SAFETY_NOTICE_VERSION + 1 })).toBe(true);
  });

  it("re-shows the notice after the version is bumped", () => {
    expect(isSafetyAcknowledged({ [SAFETY_ACK_META_KEY]: 1 }, 2)).toBe(false);
  });

  it("ignores non-numeric values a client might have written", () => {
    expect(isSafetyAcknowledged({ [SAFETY_ACK_META_KEY]: "1" })).toBe(false);
    expect(isSafetyAcknowledged({ [SAFETY_ACK_META_KEY]: true })).toBe(false);
  });

  it("builds a metadata patch with the version and timestamp", () => {
    const now = new Date("2026-10-15T12:00:00.000Z");
    expect(safetyAckMetadata(now)).toEqual({
      [SAFETY_ACK_META_KEY]: SAFETY_NOTICE_VERSION,
      [SAFETY_ACK_AT_META_KEY]: "2026-10-15T12:00:00.000Z",
    });
    expect(isSafetyAcknowledged(safetyAckMetadata(now))).toBe(true);
  });

  it("keys local storage per user and version", () => {
    expect(safetyAckStorageKey("u1")).not.toBe(safetyAckStorageKey("u2"));
    expect(safetyAckStorageKey(null)).toContain("anon");
    expect(safetyAckStorageKey("u1")).toContain(`v${SAFETY_NOTICE_VERSION}`);
  });
});

describe("normalizeSafetyNotes", () => {
  it("returns null for empty or non-string input", () => {
    expect(normalizeSafetyNotes(undefined)).toBeNull();
    expect(normalizeSafetyNotes(null)).toBeNull();
    expect(normalizeSafetyNotes(42)).toBeNull();
    expect(normalizeSafetyNotes("   ")).toBeNull();
  });

  it("trims and caps the note", () => {
    expect(normalizeSafetyNotes("  Use the crosswalk.  ")).toBe("Use the crosswalk.");
    expect(normalizeSafetyNotes("x".repeat(MAX_SAFETY_NOTES_LENGTH + 50))).toHaveLength(MAX_SAFETY_NOTES_LENGTH);
  });
});

describe("SafetyNotice", () => {
  const html = render(createElement(SafetyNotice, { onAcknowledge: vi.fn() }));

  it("is a labelled modal dialog", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="safety-notice-title"');
    expect(html).toContain("Play safely");
  });

  it("lists every safety tip", () => {
    for (const tip of SAFETY_TIPS) expect(html).toContain(tip.text);
  });

  it("covers traffic, vehicles, private property, laws, daylight and kids", () => {
    const text = SAFETY_TIPS.map((t) => t.text).join(" ").toLowerCase();
    for (const topic of ["cars", "driving", "private property", "laws", "daylight", "buddy", "adult"]) {
      expect(text).toContain(topic);
    }
  });

  it("requires an explicit I understand tap", () => {
    expect(html).toMatch(/<button[^>]*>I understand<\/button>/);
  });
});

describe("SafetyReminder and StopSafetyNote", () => {
  it("shows the walking reminder", () => {
    expect(render(createElement(SafetyReminder))).toContain(SAFETY_REMINDER);
  });

  it("shows a creator's stop note", () => {
    const html = render(createElement(StopSafetyNote, { notes: "Stay off the grass near the pond." }));
    expect(html).toContain("Safety note for this stop");
    expect(html).toContain("Stay off the grass near the pond.");
  });

  it("renders nothing without a note", () => {
    expect(render(createElement(StopSafetyNote, { notes: null }))).toBe("");
    expect(render(createElement(StopSafetyNote, { notes: "   " }))).toBe("");
    expect(render(createElement(StopSafetyNote, { notes: undefined }))).toBe("");
  });

  it("escapes note text rather than rendering it as HTML", () => {
    const html = renderToStaticMarkup(createElement(StopSafetyNote, { notes: "<img src=x onerror=alert(1)>" }));
    expect(html).not.toContain("<img");
  });

  it("renders the tip list for the hunt page", () => {
    const html = render(createElement(SafetyTipList));
    expect(html.match(/<li/g)).toHaveLength(SAFETY_TIPS.length);
  });
});

describe("PublishSafetyCheck", () => {
  const html = render(createElement(PublishSafetyCheck, { onConfirm: vi.fn(), onCancel: vi.fn() }));

  it("shows the public, safe, accessible ground affirmation", () => {
    expect(PUBLISH_SAFETY_AFFIRMATION).toMatch(/public, safe, accessible ground/);
    expect(html).toContain(PUBLISH_SAFETY_AFFIRMATION);
    expect(html).toContain('type="checkbox"');
  });

  it("keeps Submit disabled until the box is ticked", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Submit for review<\/button>/);
  });
});
