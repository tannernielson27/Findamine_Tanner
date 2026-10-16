import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import {
  redeemReferral,
  awardReferralPoints,
  REFERRAL_FRACTION,
  RECRUIT_BONUS,
  WELCOME_BONUS,
} from "@/lib/services/referral";

const VISIBLE = { display_name: "everyone", total_score: "class" };
const SHARE_100 = Math.round(100 * REFERRAL_FRACTION);

describe("referral economy against the Supabase double", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = installDouble({
      users: [
        { id: "rec", profile_visibility: { ...VISIBLE }, metadata: {} },
        { id: "rec2", profile_visibility: { ...VISIBLE }, metadata: {} },
        { id: "min", profile_visibility: {}, metadata: {} },
      ],
      referral_codes: [
        { user_id: "rec", code: "ABCD2345" },
        { user_id: "rec2", code: "WXYZ6789" },
      ],
      minion_links: [],
      // The recruiters are active study participants: the disclosure gate and
      // its switches only apply to them (non-participants: research-adults-only.int.test.ts).
      study_enrollments: ["rec", "rec2"].map((id) => ({ study_id: "s1", user_id: id, withdrawn_at: null })),
      consent_records: ["rec", "rec2"].map((id) => ({
        user_id: id, consent_type: "research", granted: true, revoked_at: null,
      })),
    });
  });

  const recruiterLedger = () => db.where("points_ledger", (r) => r.user_id === "rec");

  it("links a minion to the recruiter once, case-insensitively, and never to themselves", async () => {
    expect(await redeemReferral("rec", "ABCD2345")).toEqual({ ok: false, reason: "self_referral" });
    expect(await redeemReferral("min", "nope")).toEqual({ ok: false, reason: "invalid_code" });

    const first = await redeemReferral("min", " abcd2345 ");
    expect(first).toEqual({ ok: true, recruiterId: "rec" });
    expect(db.table("minion_links")).toHaveLength(1);
    expect(db.where("behavioral_events", (e) => e.event_type === "referral_redeemed")).toHaveLength(1);

    // One recruiter per minion — a second code is refused.
    expect(await redeemReferral("min", "WXYZ6789")).toEqual({ ok: false, reason: "already_recruited" });
    expect(db.table("minion_links")).toHaveLength(1);
  });

  it("gives the new minion a one-time welcome bonus that is not counted as referral earnings", async () => {
    await redeemReferral("min", "ABCD2345");
    await redeemReferral("min", "WXYZ6789"); // refused, so no second bonus

    const welcome = db.where("points_ledger", (r) => r.user_id === "min");
    expect(welcome).toHaveLength(1);
    expect(welcome[0]).toMatchObject({ amount: WELCOME_BONUS, source_type: "bonus" });
  });

  it("adds the recruit bonus to the first find only, then pays the plain share", async () => {
    await redeemReferral("min", "ABCD2345");
    await awardReferralPoints("min", 100, "find-1", "hunt-1");
    await awardReferralPoints("min", 100, "find-2", "hunt-1");

    const ledger = recruiterLedger();
    expect(ledger.map((r) => r.amount)).toEqual([SHARE_100 + RECRUIT_BONUS, SHARE_100]);
    expect(ledger.every((r) => r.source_type === "referral" && r.hunt_id === "hunt-1")).toBe(true);

    const paid = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_paid");
    expect(paid).toHaveLength(2);
    expect(paid[0].payload).toMatchObject({
      amount: SHARE_100 + RECRUIT_BONUS, share: SHARE_100, recruit_bonus: RECRUIT_BONUS,
      minion_id: "min", eligible: true, referral_gate: "gated", forfeit_notice: "shown",
      would_have_forfeited: false,
    });
    expect(paid[1].payload).toMatchObject({ amount: SHARE_100, recruit_bonus: 0 });
  });

  it("forfeits the whole first-find award (share + bonus) when the recruiter hides a gated field", async () => {
    await redeemReferral("min", "ABCD2345");
    const rec = db.table("users").find((u) => u.id === "rec")!;
    rec.profile_visibility = { display_name: "everyone", total_score: "nobody" };

    await awardReferralPoints("min", 100, "find-2", "hunt-1");
    expect(recruiterLedger()).toHaveLength(0);
    const forfeits = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_forfeited");
    expect(forfeits).toHaveLength(1);
    expect(forfeits[0].user_id).toBe("rec");
    expect(forfeits[0].payload).toMatchObject({
      amount: SHARE_100 + RECRUIT_BONUS, recruit_bonus: RECRUIT_BONUS, eligible: false, referral_gate: "gated",
    });

    // The bonus is offered once: becoming visible later earns the share only.
    rec.profile_visibility = { ...VISIBLE };
    await awardReferralPoints("min", 100, "find-3", "hunt-1");
    expect(recruiterLedger().map((r) => r.amount)).toEqual([SHARE_100]);
  });

  it("under the ungated switch it pays anyway and records what the gate would have done", async () => {
    await redeemReferral("min", "ABCD2345");
    const rec = db.table("users").find((u) => u.id === "rec")!;
    rec.profile_visibility = { display_name: "nobody", total_score: "nobody" };
    rec.metadata = { dim_referral_gate: "ungated", dim_forfeit_notice: "silent" };

    await awardReferralPoints("min", 40, "find-3", "hunt-1");
    expect(recruiterLedger()).toHaveLength(1);
    expect(db.where("behavioral_events", (e) => e.event_type === "referral_bonus_forfeited")).toHaveLength(0);
    const paid = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_paid");
    expect(paid[0].payload).toMatchObject({
      eligible: false, would_have_forfeited: true, referral_gate: "ungated", forfeit_notice: "silent",
    });
  });

  it("does nothing for a minion nobody recruited, or for zero points, and keeps the bonus unclaimed", async () => {
    await awardReferralPoints("min", 100, "find-1", "hunt-1");
    await redeemReferral("min", "ABCD2345");
    await awardReferralPoints("min", 0, "find-1", "hunt-1");
    expect(recruiterLedger()).toHaveLength(0);
    expect(db.where("behavioral_events", (e) => String(e.event_type).startsWith("referral_bonus"))).toHaveLength(0);
    expect(db.table("minion_links")[0].first_score_bonus_at ?? null).toBeNull();
  });
});
