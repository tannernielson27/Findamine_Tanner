import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { parseAvatarUrl } from "@/lib/media/avatar-url";
import { assertTrustedOrigin, isTrustedOrigin } from "@/lib/utils/origin";
import { assertCleanFields } from "@/lib/utils/crud-helpers";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SUPABASE = "https://abcdefghijkl.supabase.co";

describe("parseAvatarUrl (PUT /auth/profile)", () => {
  const parse = (value: unknown) => parseAvatarUrl(value, ME, SUPABASE);

  it("clears the avatar with null or an empty string", () => {
    expect(parse(null)).toEqual({ ok: true, value: null });
    expect(parse("")).toEqual({ ok: true, value: null });
  });

  it("accepts an object in the caller's own avatars folder, as a path or a storage URL", () => {
    expect(parse(`${ME}/abc-123.png`).ok).toBe(true);
    expect(parse(`avatars/${ME}/abc-123.webp`).ok).toBe(true);
    expect(parse(`${SUPABASE}/storage/v1/object/public/avatars/${ME}/abc.jpg`).ok).toBe(true);
    expect(parse(`${SUPABASE}/storage/v1/object/sign/avatars/${ME}/abc.jpg?token=x`).ok).toBe(true);
  });

  it("refuses anything else", () => {
    for (const bad of [
      `${OTHER}/abc.png`,
      `avatars/${OTHER}/abc.png`,
      `${ME}/../${OTHER}/abc.png`,
      `${ME}/abc.svg`,
      `${SUPABASE}/storage/v1/object/public/avatars/${OTHER}/abc.jpg`,
      `${SUPABASE}/storage/v1/object/public/hunt-media/${ME}/abc.jpg`,
      `${SUPABASE}/storage/v1/object/public/avatars/${ME}/..%2F${OTHER}%2Fabc.jpg`,
      `https://tracker.example/pixel.png`,
      `https://evil.example/storage/v1/object/public/avatars/${ME}/abc.jpg`,
      `javascript:alert(1)`,
      `data:image/png;base64,AAAA`,
      42,
      { url: "x" },
    ]) {
      expect(parse(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe("assertTrustedOrigin (L3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  const post = (headers: Record<string, string>) =>
    new NextRequest("https://findamine.app/api/v1/account", { method: "DELETE", headers });

  it("allows same-origin, the configured site, the Capacitor origins, and no Origin at all", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.findamine.app");
    for (const origin of ["https://findamine.app", "https://www.findamine.app", "capacitor://localhost", "https://localhost"]) {
      expect(() => assertTrustedOrigin(post({ Origin: origin }))).not.toThrow();
    }
    expect(() => assertTrustedOrigin(post({}))).not.toThrow();
  });

  it("refuses another site, and the opaque 'null' origin", () => {
    for (const origin of ["https://evil.example", "https://findamine.app.evil.example", "null", "http://findamine.app"]) {
      expect(() => assertTrustedOrigin(post({ Origin: origin }))).toThrow(/isn't allowed/);
    }
  });

  it("lets bearer-token requests through from anywhere", () => {
    expect(() => assertTrustedOrigin(post({ Origin: "https://evil.example", Authorization: "Bearer abc" }))).not.toThrow();
  });

  it("drives the CORS allow-list too", () => {
    const r = post({});
    expect(isTrustedOrigin(r, "capacitor://localhost")).toBe(true);
    expect(isTrustedOrigin(r, "https://evil.example")).toBe(false);
  });
});

describe("assertCleanFields (M5: location text and task feedback)", () => {
  it("flags blocked language in any listed field, including nested JSON", () => {
    expect(() => assertCleanFields({ name: "Quad", safety_notes: "watch out you shit" }, ["name", "safety_notes"])).toThrow(
      /The safety notes contains language/
    );
    expect(() => assertCleanFields({ feedback: { correct: "fucking great" } }, ["feedback"])).toThrow(/The feedback/);
    expect(() => assertCleanFields({ name: "Library steps", address: "1 Main St" }, ["name", "address"])).not.toThrow();
  });
});
