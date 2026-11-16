import { describe, it, expect } from "vitest";
import {
  notificationHref,
  STUDY_SURVEY_TYPE,
  SURVEY_REMINDER_TYPE,
} from "@/lib/services/notification-href";
import { CHECKIN_TARGET_PATH, PRIVACY_CHECKIN_TYPE } from "@/lib/services/privacy-checkin";
import { REENGAGEMENT_HUNT_ENTITY, REENGAGEMENT_TYPE } from "@/lib/services/reengagement";

describe("notificationHref", () => {
  it("opens the play map for a re-engagement nudge with a hunt in progress", () => {
    expect(
      notificationHref({ type: REENGAGEMENT_TYPE, entity_type: REENGAGEMENT_HUNT_ENTITY, entity_id: "h1" })
    ).toBe("/play/h1");
  });

  it("falls back to browse for a nudge without a hunt (including rows sent before this change)", () => {
    expect(notificationHref({ type: REENGAGEMENT_TYPE, entity_type: null, entity_id: null })).toBe("/browse");
    expect(notificationHref({ type: REENGAGEMENT_TYPE })).toBe("/browse");
  });

  it("keeps the existing survey and check-in destinations", () => {
    expect(notificationHref({ type: SURVEY_REMINDER_TYPE })).toBe("/surveys");
    expect(notificationHref({ type: STUDY_SURVEY_TYPE })).toBe("/settings/study");
    expect(notificationHref({ type: PRIVACY_CHECKIN_TYPE })).toBe(CHECKIN_TARGET_PATH);
  });

  it("returns null for types that are not links", () => {
    expect(notificationHref({ type: "badge_earned", entity_type: "hunt", entity_id: "h1" })).toBeNull();
  });
});
