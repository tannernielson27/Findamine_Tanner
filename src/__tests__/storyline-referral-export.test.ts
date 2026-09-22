import { describe, it, expect } from "vitest";
import {
  summarizeReferral,
  REFERRAL_HEADERS,
  type PrivacyEventLite,
  type ReferralEventLite,
} from "@/lib/services/storyline-export";

const row = (values: string[]) => Object.fromEntries(REFERRAL_HEADERS.map((h, i) => [h, values[i]]));

const ev = (event_type: string, created_at: string, payload: Record<string, unknown> = {}): ReferralEventLite => ({
  user_id: "rec",
  event_type,
  payload,
  created_at,
});

describe("summarizeReferral", () => {
  it("totals paid and forfeited awards and names the recruit bonus outcome", () => {
    const r = row(
      summarizeReferral(
        [
          ev("referral_bonus_forfeited", "2026-09-05T10:00:00Z", { amount: 65, recruit_bonus: 50 }),
          ev("forfeit_notice_viewed", "2026-09-05T12:00:00Z", { forfeited_points: 65 }),
          ev("referral_bonus_paid", "2026-09-09T10:00:00Z", { amount: 15, recruit_bonus: 0 }),
          ev("forfeit_notice_viewed", "2026-09-10T12:00:00Z"),
        ],
        []
      )
    );
    expect(r).toMatchObject({
      referral_awards_paid: "1",
      referral_points_paid: "15",
      referral_awards_forfeited: "1",
      referral_points_forfeited: "65",
      recruit_bonus_outcome: "forfeited",
      first_forfeit_at: "2026-09-05T10:00:00Z",
      forfeit_notice_views: "2",
      first_forfeit_notice_view_at: "2026-09-05T12:00:00Z",
    });
  });

  it("counts loosening and tightening saves in the 7 days after the first forfeit only", () => {
    const events: PrivacyEventLite[] = [
      { user_id: "rec", event_type: "privacy_change", metadata: { direction: "tighten" }, created_at: "2026-09-04T00:00:00Z" },
      { user_id: "rec", event_type: "privacy_change", metadata: { direction: "loosen" }, created_at: "2026-09-06T00:00:00Z" },
      { user_id: "rec", event_type: "privacy_view", metadata: {}, created_at: "2026-09-06T00:00:00Z" },
      { user_id: "rec", event_type: "privacy_change", metadata: { direction: "tighten" }, created_at: "2026-09-11T00:00:00Z" },
      { user_id: "rec", event_type: "privacy_change", metadata: { direction: "loosen" }, created_at: "2026-09-13T00:00:00Z" },
    ];
    const r = row(summarizeReferral([ev("referral_bonus_forfeited", "2026-09-05T10:00:00Z", { amount: 15 })], events));
    expect(r.loosen_saves_7d_after_first_forfeit).toBe("1");
    expect(r.tighten_saves_7d_after_first_forfeit).toBe("1");
  });

  it("leaves forfeit-relative columns blank for a recruiter who never forfeited", () => {
    const r = row(summarizeReferral([ev("referral_bonus_paid", "2026-09-05T10:00:00Z", { amount: 65, recruit_bonus: 50 })], []));
    expect(r).toMatchObject({
      recruit_bonus_outcome: "paid",
      first_forfeit_at: "",
      loosen_saves_7d_after_first_forfeit: "",
      tighten_saves_7d_after_first_forfeit: "",
    });
    expect(summarizeReferral([], [])).toHaveLength(REFERRAL_HEADERS.length);
  });
});
