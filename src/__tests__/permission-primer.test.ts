import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PRIMER_COPY,
  decidePrimer,
  deniedMessage,
  deniedTitle,
  detectPlatform,
  hasSeenPrimer,
  markPrimerSeen,
  queryPermission,
} from "@/lib/permissions/primer";
import { PermissionDeniedNotice, PermissionPrimer } from "@/components/permissions/permission-primer";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("decidePrimer", () => {
  it("skips the primer when the permission is already granted", () => {
    expect(decidePrimer("granted", false)).toBe("skip");
    expect(decidePrimer("granted", true)).toBe("skip");
  });

  it("goes straight to the denied state, since the OS won't ask again", () => {
    expect(decidePrimer("denied", false)).toBe("denied");
    expect(decidePrimer("denied", true)).toBe("denied");
  });

  it("always explains first when the OS is about to prompt", () => {
    expect(decidePrimer("prompt", false)).toBe("show");
    expect(decidePrimer("prompt", true)).toBe("show");
  });

  it("without a Permissions API, shows the primer once then trusts the real request", () => {
    expect(decidePrimer("unknown", false)).toBe("show");
    expect(decidePrimer("unknown", true)).toBe("skip");
  });
});

describe("queryPermission", () => {
  it("maps the Permissions API state and the right descriptor name", async () => {
    const query = vi.fn().mockResolvedValue({ state: "granted" });
    expect(await queryPermission("location", { permissions: { query } })).toBe("granted");
    expect(query).toHaveBeenCalledWith({ name: "geolocation" });
    query.mockResolvedValue({ state: "denied" });
    expect(await queryPermission("microphone", { permissions: { query } })).toBe("denied");
    expect(query).toHaveBeenLastCalledWith({ name: "microphone" });
  });

  it("returns unknown when the API is missing (older Safari / WKWebView)", async () => {
    expect(await queryPermission("location", {})).toBe("unknown");
    expect(await queryPermission("location", undefined)).toBe("unknown");
    expect(await queryPermission("location", { permissions: {} })).toBe("unknown");
  });

  it("returns unknown when the name is rejected instead of throwing", async () => {
    const query = vi.fn().mockRejectedValue(new TypeError("'microphone' is not a valid PermissionName"));
    expect(await queryPermission("microphone", { permissions: { query } })).toBe("unknown");
  });

  it("returns unknown for unexpected states", async () => {
    const query = vi.fn().mockResolvedValue({ state: "weird" });
    expect(await queryPermission("location", { permissions: { query } })).toBe("unknown");
  });
});

describe("detectPlatform", () => {
  it("is web without a Capacitor bridge", () => {
    expect(detectPlatform({})).toBe("web");
    expect(detectPlatform(undefined)).toBe("web");
  });

  it("is web when Capacitor reports a non-native platform", () => {
    expect(detectPlatform({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } })).toBe("web");
  });

  it("detects the native iOS and Android shells", () => {
    expect(detectPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" } })).toBe("ios");
    expect(detectPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } })).toBe("android");
  });

  it("falls back to web if the bridge throws", () => {
    const Capacitor = {
      isNativePlatform: () => {
        throw new Error("bridge not ready");
      },
    };
    expect(detectPlatform({ Capacitor })).toBe("web");
  });
});

describe("denied wording", () => {
  it("is platform-specific and never tells an app user to use browser settings", () => {
    expect(deniedMessage("location", "ios")).toBe("Turn it on in Settings > Findamine > Location to use navigation steps.");
    expect(deniedMessage("microphone", "ios")).toContain("Settings > Findamine > Microphone");
    expect(deniedMessage("location", "ios")).not.toMatch(/browser/i);
    expect(deniedMessage("location", "android")).not.toMatch(/browser/i);
    expect(deniedMessage("location", "web")).toMatch(/browser's site settings/);
  });

  it("names the permission in the heading", () => {
    expect(deniedTitle("location")).toBe("Location is off for Findamine");
    expect(deniedTitle("microphone")).toBe("Microphone is off for Findamine");
  });
});

describe("primer memory", () => {
  it("remembers that the player continued, per permission", () => {
    const storage = memoryStorage();
    expect(hasSeenPrimer("location", storage)).toBe(false);
    markPrimerSeen("location", storage);
    expect(hasSeenPrimer("location", storage)).toBe(true);
    expect(hasSeenPrimer("microphone", storage)).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => markPrimerSeen("location", blocked)).not.toThrow();
    expect(hasSeenPrimer("location", blocked)).toBe(false);
    expect(hasSeenPrimer("location", undefined)).toBe(false);
  });
});

describe("primer copy", () => {
  it("gives every permission a plain reason and a single Continue action", () => {
    for (const copy of Object.values(PRIMER_COPY)) {
      expect(copy.reason.startsWith("Findamine uses your")).toBe(true);
      expect(copy.continueLabel).toBe("Continue");
      // App Review 5.1.1(iv): nothing in the primer may skip the system prompt.
      expect(Object.keys(copy)).not.toContain("dismissLabel");
      expect(JSON.stringify(copy)).not.toMatch(/not now/i);
    }
  });

  it("states location is not used in the background", () => {
    expect(PRIMER_COPY.location.reason).toMatch(/never track you in the background/);
  });
});

describe("components", () => {
  it("renders nothing while checking, so the primer never flashes for granted users", () => {
    const html = renderToStaticMarkup(
      createElement(PermissionPrimer, { kind: "location", onContinue: () => {} })
    );
    expect(html).toBe("");
  });

  it("renders the denied notice as an alert with neutral wording and fallback actions", () => {
    const html = renderToStaticMarkup(
      createElement(PermissionDeniedNotice, { kind: "location" }, createElement("button", null, "Skip to Challenge"))
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Location is off for Findamine");
    expect(html).toContain("Skip to Challenge");
  });
});
