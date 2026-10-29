import { describe, expect, it } from "vitest";
import { detailCta, isOwnerPreview } from "@/app/(app)/browse/[id]/cta-state";

const base = { playable: true, signedIn: true, teamHunt: false, ownerPreview: false };

describe("detailCta", () => {
  it("asks signed-out visitors to sign in, with a note on closed hunts", () => {
    expect(detailCta({ ...base, signedIn: false })).toBe("sign_in");
    expect(detailCta({ ...base, signedIn: false, playable: false })).toBe("sign_in_closed");
  });

  it("shows only the closed note to signed-in viewers of a closed hunt", () => {
    expect(detailCta({ ...base, playable: false })).toBe("closed");
    expect(detailCta({ ...base, playable: false, teamHunt: true, ownerPreview: true })).toBe("closed");
  });

  it("starts solo hunts directly", () => {
    expect(detailCta(base)).toBe("start");
  });

  it("sends team players to the team panel", () => {
    expect(detailCta({ ...base, teamHunt: true })).toBe("team");
  });

  it("offers Preview to a hunt manager who isn't on a team", () => {
    expect(detailCta({ ...base, teamHunt: true, ownerPreview: true })).toBe("preview");
  });

  it("ignores ownerPreview on solo hunts", () => {
    expect(detailCta({ ...base, ownerPreview: true })).toBe("start");
  });
});

describe("isOwnerPreview", () => {
  it("is true for a manager off-team on a teacher-formed hunt", () => {
    expect(isOwnerPreview({ playMode: "team_assigned", canManage: true, onTeam: false })).toBe(true);
  });

  it("is false once the manager is on a team", () => {
    expect(isOwnerPreview({ playMode: "team_assigned", canManage: true, onTeam: true })).toBe(false);
  });

  it("is false for players who can't manage the hunt", () => {
    expect(isOwnerPreview({ playMode: "team_assigned", canManage: false, onTeam: false })).toBe(false);
  });

  it("is false on self-select hunts, where the panel asks them to pick a team", () => {
    expect(isOwnerPreview({ playMode: "team_self_select", canManage: true, onTeam: false })).toBe(false);
  });

  it("is false on solo hunts", () => {
    expect(isOwnerPreview({ playMode: "solo", canManage: true, onTeam: false })).toBe(false);
  });
});
