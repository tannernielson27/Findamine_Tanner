import { describe, expect, it } from "vitest";
import { audienceLabel, huntStatusLabel, stopCountLabel, updatedLabel } from "@/app/(app)/dashboard/hunts/hunt-list-format";
import { joinedLabel, profileSubtitle, roleLabel } from "@/app/(app)/dashboard/profile/profile-format";

describe("My Hunts list labels", () => {
  it("uses Home's status words and tones", () => {
    expect(huntStatusLabel("draft")).toEqual({ label: "Draft", tone: "neutral" });
    expect(huntStatusLabel("published")).toEqual({ label: "Live", tone: "juniper" });
    expect(huntStatusLabel("enrollment_open")).toEqual({ label: "Live", tone: "juniper" });
    expect(huntStatusLabel("in_progress")).toEqual({ label: "Live", tone: "juniper" });
    expect(huntStatusLabel("ended")).toEqual({ label: "Ended", tone: "sky" });
    expect(huntStatusLabel(null)).toEqual({ label: "Draft", tone: "neutral" });
  });

  it("capitalizes audiences", () => {
    expect(audienceLabel("adults")).toBe("Adults");
    expect(audienceLabel("kids")).toBe("Kids");
    expect(audienceLabel("all")).toBe("All ages");
    expect(audienceLabel("seniors")).toBe("Seniors");
    expect(audienceLabel("")).toBeNull();
    expect(audienceLabel(null)).toBeNull();
  });

  it("pluralizes stops", () => {
    expect(stopCountLabel(0)).toBe("0 stops");
    expect(stopCountLabel(1)).toBe("1 stop");
    expect(stopCountLabel(5)).toBe("5 stops");
  });

  it("formats the updated date, adding the year only when it differs", () => {
    const now = new Date("2026-10-29T12:00:00Z");
    expect(updatedLabel("2026-10-15T08:00:00Z", now, "UTC")).toBe("Updated Oct 15");
    expect(updatedLabel("2025-03-02T08:00:00Z", now, "UTC")).toBe("Updated Mar 2, 2025");
  });

  it("returns an empty string for missing or bad dates", () => {
    expect(updatedLabel(null)).toBe("");
    expect(updatedLabel("not a date")).toBe("");
  });
});

describe("Profile header labels", () => {
  it("capitalizes roles", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("hunt_creator")).toBe("Hunt creator");
    expect(roleLabel("")).toBe("");
    expect(roleLabel(null)).toBe("");
  });

  it("formats the join month", () => {
    expect(joinedLabel("2026-09-22T10:00:00Z", "UTC")).toBe("Joined Sep 2026");
    expect(joinedLabel("nope")).toBe("");
    expect(joinedLabel(undefined)).toBe("");
  });

  it("joins role and date, skipping missing parts", () => {
    expect(profileSubtitle("admin", "2026-09-22T10:00:00Z", "UTC")).toBe("Admin · Joined Sep 2026");
    expect(profileSubtitle("teen", null)).toBe("Teen");
    expect(profileSubtitle(null, "2026-09-22T10:00:00Z", "UTC")).toBe("Joined Sep 2026");
  });
});
