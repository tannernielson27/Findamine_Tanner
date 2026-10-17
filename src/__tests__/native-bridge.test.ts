import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* Plugin doubles: the native code paths import these lazily. */
const plugins = vi.hoisted(() => ({
  watchCallback: null as null | ((pos: unknown, err?: unknown) => void),
  watchIds: [] as string[],
  cleared: [] as string[],
  resolveWatch: null as null | (() => void),
  geoPermission: "prompt" as string,
  cameraPermission: "granted" as string,
  pushPermission: "denied" as string,
  current: { coords: { latitude: 40.25, longitude: -111.65, accuracy: 8 } } as unknown,
  currentError: null as unknown,
}));

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    watchPosition: (_opts: unknown, cb: (pos: unknown, err?: unknown) => void) => {
      plugins.watchCallback = cb;
      const id = `w${plugins.watchIds.length + 1}`;
      plugins.watchIds.push(id);
      return new Promise<string>((resolve) => {
        plugins.resolveWatch = () => resolve(id);
      });
    },
    clearWatch: async ({ id }: { id: string }) => {
      plugins.cleared.push(id);
    },
    getCurrentPosition: async () => {
      if (plugins.currentError) throw plugins.currentError;
      return plugins.current;
    },
    checkPermissions: async () => ({ location: plugins.geoPermission, coarseLocation: plugins.geoPermission }),
  },
}));
vi.mock("@capacitor/camera", () => ({
  Camera: { checkPermissions: async () => ({ camera: plugins.cameraPermission, photos: "granted" }) },
}));
vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: { checkPermissions: async () => ({ receive: plugins.pushPermission }) },
}));

import { APP_HOSTS, inAppPath, isAppHost } from "@/lib/native/app-hosts";
import { isNativeApp, nativePlatform } from "@/lib/native/platform";
import {
  LocationError,
  classifyLocationError,
  getCurrentLocation,
  locationSupported,
  watchLocation,
} from "@/lib/native/geolocation";
import { base64ToFile, classifyPhotoError, mimeForFormat, PhotoError } from "@/lib/native/camera";
import { fromNativeState, queryPlatformPermission } from "@/lib/native/permissions";
import { openInApp } from "@/lib/native/bootstrap";
import { PRIMER_COPY, deniedMessage, deniedTitle } from "@/lib/permissions/primer";

const NATIVE_IOS = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" } };
const WEB_CORE = { Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } };

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

function stubNative() {
  vi.stubGlobal("window", NATIVE_IOS);
}

beforeEach(() => {
  plugins.watchCallback = null;
  plugins.watchIds = [];
  plugins.cleared = [];
  plugins.resolveWatch = null;
  plugins.geoPermission = "prompt";
  plugins.currentError = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("app hosts allow-list", () => {
  it("knows today's host and the future domain", () => {
    expect(APP_HOSTS).toEqual(["findamine-tanner.vercel.app", "findamine.app", "www.findamine.app"]);
    expect(isAppHost("FINDAMINE.APP")).toBe(true);
    expect(isAppHost("findamine.app.")).toBe(true);
    expect(isAppHost("evil-findamine.app")).toBe(false);
    expect(isAppHost("findamine.app.evil.com")).toBe(false);
    expect(isAppHost("")).toBe(false);
    expect(isAppHost(null)).toBe(false);
  });

  it("turns our https links into in-app paths", () => {
    expect(inAppPath("https://findamine.app/play/abc?x=1#top")).toBe("/play/abc?x=1#top");
    expect(inAppPath("https://findamine-tanner.vercel.app/")).toBe("/");
  });

  it("refuses everything else", () => {
    for (const url of [
      "http://findamine.app/play",
      "https://evil.example/play",
      "https://findamine.app.evil.com/",
      "https://user:pw@findamine.app/",
      "https://findamine.app:8443/",
      "javascript:alert(1)",
      "findamine://play",
      "not a url",
      "",
      null,
    ]) {
      expect(inAppPath(url)).toBeNull();
    }
  });

  it("openInApp only navigates for our hosts", () => {
    const nav = { assign: vi.fn() };
    expect(openInApp("https://findamine.app/dashboard", nav)).toBe(true);
    expect(nav.assign).toHaveBeenCalledWith("/dashboard");
    expect(openInApp("https://evil.example/x", nav)).toBe(false);
    expect(nav.assign).toHaveBeenCalledTimes(1);
  });
});

describe("native detection", () => {
  it("is web on the server and in a plain browser", () => {
    expect(isNativeApp()).toBe(false);
    expect(isNativeApp({})).toBe(false);
    expect(nativePlatform(undefined)).toBe("web");
  });

  it("is web when @capacitor/core is loaded in a browser", () => {
    expect(isNativeApp(WEB_CORE)).toBe(false);
  });

  it("is ios inside the wrapper", () => {
    expect(isNativeApp(NATIVE_IOS)).toBe(true);
    expect(nativePlatform(NATIVE_IOS)).toBe("ios");
  });

  it("never throws on a hostile or broken global", () => {
    const broken = {
      Capacitor: {
        isNativePlatform: () => {
          throw new Error("boom");
        },
      },
    };
    expect(isNativeApp(broken)).toBe(false);
    expect(isNativeApp({ Capacitor: { isNativePlatform: "yes" } })).toBe(false);
  });
});

describe("classifyLocationError", () => {
  it("maps web GeolocationPositionError codes", () => {
    expect(classifyLocationError({ code: 1, message: "User denied Geolocation" })).toBe("denied");
    expect(classifyLocationError({ code: 2 })).toBe("unavailable");
    expect(classifyLocationError({ code: 3 })).toBe("timeout");
  });

  it("maps Capacitor plugin codes and messages", () => {
    expect(classifyLocationError({ code: "OS-PLUG-GLOC-0003", message: "Location permission request was denied." })).toBe("denied");
    expect(classifyLocationError({ code: "OS-PLUG-GLOC-0008" })).toBe("denied");
    expect(classifyLocationError({ code: "OS-PLUG-GLOC-0010" })).toBe("timeout");
    expect(classifyLocationError({ code: "OS-PLUG-GLOC-0007", message: "Location services are not enabled." })).toBe("unavailable");
    expect(classifyLocationError(new Error("Location permission was denied"))).toBe("denied");
    expect(classifyLocationError(new Error("Request timed out"))).toBe("timeout");
    expect(classifyLocationError(new LocationError("timeout"))).toBe("timeout");
    expect(classifyLocationError(undefined)).toBe("unavailable");
  });
});

describe("watchLocation / getCurrentLocation on the web", () => {
  it("reports unavailable without the Geolocation API", () => {
    vi.stubGlobal("navigator", {});
    const onError = vi.fn();
    const stop = watchLocation(vi.fn(), onError);
    expect(locationSupported()).toBe(false);
    expect(onError).toHaveBeenCalledWith("unavailable");
    expect(() => stop()).not.toThrow();
  });

  it("delegates to navigator.geolocation and clears the same watch", () => {
    let success: ((p: unknown) => void) | null = null;
    let failure: ((e: unknown) => void) | null = null;
    const geo = {
      watchPosition: vi.fn((s, f) => {
        success = s;
        failure = f;
        return 7;
      }),
      clearWatch: vi.fn(),
    };
    vi.stubGlobal("navigator", { geolocation: geo });
    const onFix = vi.fn();
    const onError = vi.fn();
    const stop = watchLocation(onFix, onError, { enableHighAccuracy: true });
    expect(geo.watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true });
    success!({ coords: { latitude: 1, longitude: 2, accuracy: 3 } });
    failure!({ code: 1 });
    expect(onFix).toHaveBeenCalledWith({ latitude: 1, longitude: 2, accuracy: 3 });
    expect(onError).toHaveBeenCalledWith("denied");
    stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it("getCurrentLocation rejects with a classified LocationError", async () => {
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition: (_s: unknown, f: (e: unknown) => void) => f({ code: 1, message: "denied" }) },
    });
    await expect(getCurrentLocation()).rejects.toMatchObject({ name: "LocationError", kind: "denied" });
  });
});

describe("watchLocation / getCurrentLocation in the iOS app", () => {
  it("uses the Capacitor plugin and clears the watch on stop", async () => {
    stubNative();
    const onFix = vi.fn();
    const stop = watchLocation(onFix, vi.fn());
    await flush();
    plugins.resolveWatch!();
    await flush();
    plugins.watchCallback!({ coords: { latitude: 5, longitude: 6, accuracy: null } });
    expect(onFix).toHaveBeenCalledWith({ latitude: 5, longitude: 6, accuracy: null });
    stop();
    expect(plugins.cleared).toEqual(["w1"]);
  });

  it("clears a watch that finishes starting after stop() was called", async () => {
    stubNative();
    const onFix = vi.fn();
    const stop = watchLocation(onFix, vi.fn());
    await flush();
    stop();
    plugins.resolveWatch!();
    await flush();
    expect(plugins.cleared).toEqual(["w1"]);
    plugins.watchCallback!({ coords: { latitude: 5, longitude: 6 } });
    expect(onFix).not.toHaveBeenCalled();
  });

  it("passes plugin errors through as kinds", async () => {
    stubNative();
    const onError = vi.fn();
    watchLocation(vi.fn(), onError);
    await flush();
    plugins.watchCallback!(null, { code: "OS-PLUG-GLOC-0003" });
    expect(onError).toHaveBeenCalledWith("denied");
  });

  it("getCurrentLocation resolves a fix or a LocationError", async () => {
    stubNative();
    await expect(getCurrentLocation()).resolves.toEqual({ latitude: 40.25, longitude: -111.65, accuracy: 8 });
    plugins.currentError = { code: "OS-PLUG-GLOC-0010", message: "timeout" };
    await expect(getCurrentLocation()).rejects.toMatchObject({ kind: "timeout" });
    expect(locationSupported()).toBe(true);
  });
});

describe("native permission state for the primer", () => {
  it("maps Capacitor states", () => {
    expect(fromNativeState("granted")).toBe("granted");
    expect(fromNativeState("limited")).toBe("granted");
    expect(fromNativeState("denied")).toBe("denied");
    expect(fromNativeState("prompt")).toBe("prompt");
    expect(fromNativeState("prompt-with-rationale")).toBe("prompt");
    expect(fromNativeState(undefined)).toBe("unknown");
    expect(fromNativeState("weird")).toBe("unknown");
  });

  it("asks the plugins inside the app", async () => {
    stubNative();
    plugins.geoPermission = "denied";
    expect(await queryPlatformPermission("location")).toBe("denied");
    expect(await queryPlatformPermission("camera")).toBe("granted");
    expect(await queryPlatformPermission("notifications")).toBe("denied");
  });

  it("uses the browser Permissions API on the web (and for the microphone)", async () => {
    vi.stubGlobal("navigator", { permissions: { query: async () => ({ state: "prompt" }) } });
    expect(await queryPlatformPermission("location")).toBe("prompt");
    expect(await queryPlatformPermission("microphone")).toBe("prompt");
  });
});

describe("native camera helpers", () => {
  it("classifies plugin errors", () => {
    expect(classifyPhotoError({ code: "OS-PLUG-CAMR-0006" })).toBe("cancelled");
    expect(classifyPhotoError({ code: "OS-PLUG-CAMR-0020" })).toBe("cancelled");
    expect(classifyPhotoError({ code: "OS-PLUG-CAMR-0003" })).toBe("denied");
    expect(classifyPhotoError(new Error("User cancelled photos app"))).toBe("cancelled");
    expect(classifyPhotoError(new Error("Couldn't take photo."))).toBe("failed");
    expect(classifyPhotoError(new PhotoError("denied"))).toBe("denied");
  });

  it("maps formats to MIME types", () => {
    expect(mimeForFormat("jpeg")).toBe("image/jpeg");
    expect(mimeForFormat("JPG")).toBe("image/jpeg");
    expect(mimeForFormat("image/png")).toBe("image/png");
    expect(mimeForFormat("heic")).toBe("image/heic");
    expect(mimeForFormat(undefined)).toBe("image/jpeg");
  });

  it("builds a File from base64 or a data URL", async () => {
    const b64 = Buffer.from("hello").toString("base64");
    const a = base64ToFile(b64, "image/jpeg", "a.jpg");
    const b = base64ToFile(`data:image/png;base64,${b64}`, "image/png", "b.png");
    expect(a.name).toBe("a.jpg");
    expect(a.type).toBe("image/jpeg");
    expect(await a.text()).toBe("hello");
    expect(await b.text()).toBe("hello");
  });
});

describe("primer copy for the native permissions", () => {
  it("explains camera and notifications before the iOS prompt", () => {
    expect(PRIMER_COPY.camera.reason).toMatch(/only when you tap Take Photo/);
    expect(PRIMER_COPY.notifications.reason).toMatch(/turn them off/);
    expect(deniedTitle("camera")).toBe("Camera is off for Findamine");
    expect(deniedMessage("notifications", "ios")).toBe(
      "Turn it on in Settings > Findamine > Notifications to use notifications."
    );
  });
});
