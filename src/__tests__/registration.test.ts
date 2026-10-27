import { describe, it, expect } from "vitest";
import {
  resolveSelfRegisterRole,
  ageInYears,
  normalizeEmail,
  isPlausibleEmail,
  escapeLikePattern,
  wasCreatedDuringRequest,
} from "@/lib/utils/registration";

const NOW = new Date("2026-09-14T12:00:00Z").getTime();

describe("resolveSelfRegisterRole", () => {
  const confirmed = { ageConfirmed: true };

  it("accepts an adult or teen who confirms their age, with no date of birth", () => {
    expect(resolveSelfRegisterRole("adult", confirmed, NOW)).toEqual({ ok: true, role: "adult" });
    expect(resolveSelfRegisterRole("teen", confirmed, NOW)).toEqual({ ok: true, role: "teen" });
  });

  it("requires an age confirmation (or a date of birth) for teen and adult", () => {
    expect(resolveSelfRegisterRole("adult", {}, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(resolveSelfRegisterRole("teen", { ageConfirmed: false, dateOfBirth: "" }, NOW)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(resolveSelfRegisterRole("adult", { ageConfirmed: "yes" }, NOW)).toMatchObject({ ok: false, status: 400 });
  });

  it("still honors an optional date of birth from older clients", () => {
    expect(resolveSelfRegisterRole("adult", { dateOfBirth: "2005-01-01" }, NOW)).toEqual({ ok: true, role: "adult" });
    const r = resolveSelfRegisterRole("adult", { dateOfBirth: "2010-01-01", ageConfirmed: true }, NOW);
    expect(r.ok === false && r.status).toBe(403);
    expect(resolveSelfRegisterRole("teen", { dateOfBirth: "2011-01-01" }, NOW)).toEqual({ ok: true, role: "teen" });
    expect(resolveSelfRegisterRole("teen", { dateOfBirth: "2016-01-01" }, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(resolveSelfRegisterRole("teen", { dateOfBirth: "2000-01-01" }, NOW)).toEqual({ ok: true, role: "adult" });
  });

  it("passes staff-style roles through without an age gate and falls back to parent", () => {
    expect(resolveSelfRegisterRole("teacher", {}, NOW)).toEqual({ ok: true, role: "teacher" });
    expect(resolveSelfRegisterRole("admin", {}, NOW)).toEqual({ ok: true, role: "parent" });
    expect(resolveSelfRegisterRole(undefined, {}, NOW)).toEqual({ ok: true, role: "parent" });
  });
});

describe("ageInYears", () => {
  it("floors to whole years", () => {
    expect(ageInYears("2008-09-15", NOW)).toBe(17);
    expect(ageInYears("2008-09-13", NOW)).toBe(18);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, and tolerates non-strings", () => {
    expect(normalizeEmail("  Ana.Lopez@BYU.edu ")).toBe("ana.lopez@byu.edu");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses and refuses obvious non-addresses", () => {
    expect(isPlausibleEmail("a@byu.edu")).toBe(true);
    expect(isPlausibleEmail("not-an-email")).toBe(false);
    expect(isPlausibleEmail("a b@byu.edu")).toBe(false);
    expect(isPlausibleEmail("a@byu")).toBe(false);
  });
});

describe("escapeLikePattern", () => {
  it("escapes wildcards so an address only matches itself", () => {
    expect(escapeLikePattern("first_last%x@byu.edu")).toBe("first\\_last\\%x@byu.edu");
    expect(escapeLikePattern("plain@byu.edu")).toBe("plain@byu.edu");
  });
});

describe("wasCreatedDuringRequest", () => {
  const STARTED = new Date("2026-10-05T12:00:00Z").getTime();

  it("is true only for a user created at or after the request began (allowing clock skew)", () => {
    expect(wasCreatedDuringRequest("2026-10-05T12:00:01Z", STARTED)).toBe(true);
    expect(wasCreatedDuringRequest("2026-10-05T11:59:45Z", STARTED)).toBe(true);
  });

  it("is false for an account that already existed, and for missing or bad timestamps", () => {
    expect(wasCreatedDuringRequest("2026-10-05T11:50:00Z", STARTED)).toBe(false);
    expect(wasCreatedDuringRequest("2026-09-01T00:00:00Z", STARTED)).toBe(false);
    expect(wasCreatedDuringRequest(undefined, STARTED)).toBe(false);
    expect(wasCreatedDuringRequest("not a date", STARTED)).toBe(false);
  });
});