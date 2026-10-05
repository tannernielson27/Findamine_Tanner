import { describe, it, expect } from "vitest";
import { safeReturnPath, returnLabel } from "@/app/(app)/surveys/return-path";
import { parsePrivacyDraft } from "@/app/(app)/settings/privacy/privacy-page-data";
import { participationFromEnrollments } from "@/lib/services/participant-conditions";

describe("safeReturnPath", () => {
  it("accepts in-app paths", () => {
    expect(safeReturnPath("/settings/privacy")).toBe("/settings/privacy");
    expect(safeReturnPath("/settings/privacy?from=checkin")).toBe("/settings/privacy?from=checkin");
  });

  it.each([
    null,
    undefined,
    "",
    "settings/privacy",
    "https://evil.example/settings/privacy",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "javascript:alert(1)",
    "/" + "a".repeat(600),
  ])("rejects %j", (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });

  it("labels the privacy page destination", () => {
    expect(returnLabel("/settings/privacy")).toBe("Back to privacy settings");
    expect(returnLabel("/dashboard")).toBe("Continue");
  });
});

describe("parsePrivacyDraft", () => {
  it("round-trips a valid draft", () => {
    const draft = {
      visibility: { real_name: "nobody", total_score: "class" },
      overrides: { "user-2": { badges: "everyone" } },
    };
    expect(parsePrivacyDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("drops unknown fields, invalid levels and emptied override entries", () => {
    const raw = JSON.stringify({
      visibility: { real_name: "nobody", not_a_field: "nobody", avatar: "friends" },
      overrides: { "user-2": { badges: "sometimes" }, "user-3": { avatar: "nobody" } },
    });
    expect(parsePrivacyDraft(raw)).toEqual({
      visibility: { real_name: "nobody" },
      overrides: { "user-3": { avatar: "nobody" } },
    });
  });

  it.each([null, "", "not json", "[]", "42"])("returns null for %j", (raw) => {
    expect(parsePrivacyDraft(raw)).toBeNull();
  });
});

describe("participationFromEnrollments", () => {
  it("classifies never-enrolled, active and withdrawn users", () => {
    expect(participationFromEnrollments([])).toBe("none");
    expect(participationFromEnrollments([{ withdrawn_at: null }])).toBe("participant");
    expect(participationFromEnrollments([{ withdrawn_at: "2026-09-01T00:00:00Z" }])).toBe("withdrawn");
    expect(
      participationFromEnrollments([{ withdrawn_at: "2026-09-01T00:00:00Z" }, { withdrawn_at: null }])
    ).toBe("participant");
  });
});
