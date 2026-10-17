import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import config, { APP_URL } from "../../capacitor.config";
import { APP_HOSTS } from "@/lib/native/app-hosts";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** <string> values for each NS*UsageDescription key in an Info.plist / the docs' XML block. */
function purposeStrings(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<key>(NS\w+UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

describe("capacitor.config.ts", () => {
  it("identifies the app", () => {
    expect(config.appId).toBe("app.findamine");
    expect(config.appName).toBe("Findamine");
  });

  it("loads the remote site over https from an allowed host", () => {
    const url = new URL(APP_URL);
    expect(url.protocol).toBe("https:");
    expect(config.server?.url).toBe(APP_URL);
    expect(APP_HOSTS).toContain(url.hostname);
  });

  it("allows exactly the app hosts, including findamine.app for the later redirect", () => {
    expect(config.server?.allowNavigation).toEqual([...APP_HOSTS]);
    expect(config.server?.allowNavigation).toEqual(
      expect.arrayContaining(["findamine-tanner.vercel.app", "findamine.app", "www.findamine.app"])
    );
    expect(config.server?.cleartext).toBeFalsy();
  });

  it("bundles the shell pages it points at", () => {
    expect(config.webDir).toBe("ios-shell");
    expect(existsSync(resolve(root, "ios-shell/index.html"))).toBe(true);
    expect(existsSync(resolve(root, "ios-shell", config.server!.errorPath!))).toBe(true);
  });

  it("keeps ios-shell/app-url.js in step with APP_URL (npm run ios:sync regenerates it)", () => {
    expect(read("ios-shell/app-url.js")).toContain(`window.FINDAMINE_APP_URL = ${JSON.stringify(APP_URL)};`);
  });

  it("gives the offline page a retry button and no remote assets", () => {
    const html = read("ios-shell/offline.html");
    expect(html).toContain('id="retry"');
    expect(html).toContain('src="app-url.js"');
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});

describe("iOS Info.plist", () => {
  const plist = read("ios/App/App/Info.plist");

  it("declares the same purpose strings as docs/ios-permission-strings.md", () => {
    const fromDocs = purposeStrings(read("docs/ios-permission-strings.md"));
    expect(Object.keys(fromDocs).sort()).toEqual([
      "NSCameraUsageDescription",
      "NSLocationWhenInUseUsageDescription",
      "NSMicrophoneUsageDescription",
      "NSPhotoLibraryUsageDescription",
    ]);
    expect(purposeStrings(plist)).toEqual(fromDocs);
  });

  it("never asks for background location", () => {
    expect(plist).not.toMatch(/<key>NSLocationAlways/);
    expect(plist).not.toMatch(/<key>UIBackgroundModes/);
  });

  it("has the push entitlement wired into the target", () => {
    expect(read("ios/App/App/App.entitlements")).toContain("<key>aps-environment</key>");
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/g)).toHaveLength(2);
    expect(pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.findamine;/g)).toHaveLength(2);
  });
});
