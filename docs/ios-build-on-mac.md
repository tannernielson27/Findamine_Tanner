# Building the iOS app on a Mac

The iOS app is a Capacitor 8 wrapper around the live site. It loads `APP_URL` from `capacitor.config.ts` (today `https://findamine-tanner.vercel.app`) and adds native features through Capacitor plugins: location (Core Location), camera and photo picker, push notifications, status bar, launch splash, safe-area layout, and a bundled offline screen. Web code for these lives in `src/lib/native/` and `src/components/native/`. On the web every one of them falls back to the old browser behaviour.

The Xcode project (`ios/`) was generated with `npx cap add ios` and is committed. It uses **Swift Package Manager** (the Capacitor 8 default), so **CocoaPods isn't needed**.

## 1. One-time Mac setup

1. **macOS and Xcode.** Install the current Xcode from the Mac App Store (Capacitor 8 needs Xcode 16 or newer; the deployment target is iOS 15). Open it once to accept the licence and install the iOS platform, then run:
   ```sh
   xcode-select --install          # command-line tools, if not already installed
   sudo xcodebuild -license accept
   ```
2. **Node.** Use the same major version as the Windows machine (Node 22, npm 10). With Homebrew:
   ```sh
   brew install node@22 && brew link --overwrite node@22
   node --version   # v22.x
   ```
   Or use nvm (`nvm install 22`).
3. **Apple Developer account.** In Xcode, open **Settings > Accounts**, add the Apple ID that belongs to the developer team, and check that the team appears.

## 2. Get the code and open the project

```sh
git clone <repo-url> findamineapp
cd findamineapp
git switch feat/ios-wrapper          # or main, once merged
npm ci                               # installs Capacitor and the plugins (Package.swift points into node_modules)
npm run ios:sync                     # writes ios-shell/app-url.js from APP_URL, then `npx cap sync ios`
npm run ios:open                     # same as `npx cap open ios`; opens ios/App/App.xcodeproj
```

You don't need `next build` or any `.env` file: the app loads the deployed site.

When Xcode opens, it resolves the Swift packages (`capacitor-swift-pm` from GitHub and the plugins from `node_modules`). Wait for "Resolving Package Graph" to finish. If it fails, use **File > Packages > Reset Package Caches**.

## 3. Signing, bundle ID and capabilities

Select the **App** project, then the **App** target.

1. **Signing & Capabilities > Signing:** check "Automatically manage signing" and pick your **Team**.
2. **Bundle Identifier:** `app.findamine`. It's already set and already registered in App Store Connect.
3. **Capabilities:** **Push Notifications** is already on. `ios/App/App/App.entitlements` holds `aps-environment` and the build settings point at it. If Xcode shows a signing error about it, remove the capability, add it again with **+ Capability > Push Notifications**, and let Xcode regenerate the profile. Don't add **Background Modes**: the app doesn't use background location or silent pushes.
4. **General > Identity:** set **Version** (for example `1.0`) and **Build** (`1`). Raise Build on every upload.
5. Optional: **General > Supported Destinations** lists iPhone and iPad. If you don't want to make iPad screenshots and pass iPad review, remove iPad (iPhone only).

## 4. Run it

- **Simulator:** choose an iPhone simulator and press Run (⌘R). Location: **Features > Location > Custom Location…** in the Simulator. The camera doesn't work in the Simulator; "Choose from library" does. Test push registration on a real device.
- **Device:** plug in the iPhone, trust the computer, pick it as the run destination, and press Run. The first time, approve the developer profile on the phone under **Settings > General > VPN & Device Management**. Developer Mode must be on (**Settings > Privacy & Security > Developer Mode**).

What to check on a device before uploading:

1. The launch splash (compass on paper) fades into the site. The status bar text is dark and the navbar sits below the notch / Dynamic Island.
2. Sign in works and stays signed in after you quit and reopen the app.
3. Play a hunt: the location primer appears **before** the iOS location prompt, the map follows you, and arrival triggers.
4. Geo-Selfie: **Take Photo** shows the camera primer, then the iOS camera prompt, then the camera. **Choose from library** opens the photo picker. The upload completes.
5. Audio challenge: the microphone primer, then the iOS prompt, then recording.
6. **Settings > Notifications** (adult or teen account): "Turn on notifications" shows the primer, then the iOS prompt. The section isn't shown on a child account or on the website.
7. Turn on Airplane Mode and relaunch: the bundled "You're offline" screen appears. Turn Airplane Mode off and it reconnects by itself, or tap **Try again**.
8. Tap any link to another site: it opens in Safari, not inside the app.

## 5. Archive, upload, TestFlight

1. Set the run destination to **Any iOS Device (arm64)**.
2. **Product > Archive.** When the Organizer opens, select the archive and choose **Distribute App > App Store Connect > Upload**. Keep automatic signing. `ITSAppUsesNonExemptEncryption` is already `NO` in Info.plist (HTTPS only), so there's no export-compliance question.
3. In [App Store Connect](https://appstoreconnect.apple.com) > the Findamine app > **TestFlight**, the build appears after processing (usually 5–30 minutes). Add yourself to Internal Testing and install it with the TestFlight app.
4. For review, fill in the App Privacy answers (location, photos, audio, account email; device ID for push), the review notes (a demo login, and a note that location is used only while playing), and screenshots.

## 6. Settings outside the app

### Supabase

Auth doesn't need any redirect-URL changes for the app. Sign-in is email and password through `/api/v1/auth/login`, so the session is a cookie on the site's own origin. That works unchanged in WKWebView, and WKWebView keeps the cookie between launches. Verification and password-reset emails use `token_hash` links built from `NEXT_PUBLIC_SITE_URL` (`/api/auth/confirm`), not Supabase's redirect allow-list.

- Apply migration `supabase/migrations/078_push_devices.sql` with the other pending migrations (after 071–077). Until it's applied, the device route answers 503 and the app shows "We couldn't turn on notifications".
- When the domain moves, set **Authentication > URL Configuration > Site URL** to `https://findamine.app` and add `https://findamine.app/**` to **Redirect URLs**. Nothing uses them today, but they stop any Supabase-built email from pointing at the old host.

Known limitation: email links open in Safari, not in the app. A player who verifies their email or resets their password does that in Safari and then signs in inside the app. Universal links (below) fix this.

### Vercel

- Nothing is needed for the current host.
- The API's CSRF check already trusts the app's origins (`src/lib/utils/trusted-origins.ts`): the page origin, `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_APP_URL`, and `capacitor://localhost`.
- When findamine.app is live, set `NEXT_PUBLIC_SITE_URL=https://findamine.app` in the Production environment and redeploy.

## 7. Moving APP_URL to findamine.app

1. Add `findamine.app` and `www.findamine.app` to the Vercel project and wait for TLS to be issued.
2. In Vercel, redirect `findamine-tanner.vercel.app` to `https://findamine.app` (permanent, path kept). Builds already installed keep working: all three hosts are in `server.allowNavigation`, so the redirect stays inside the app.
3. In `capacitor.config.ts`, change the one line `const APP_URL = "https://findamine-tanner.vercel.app";` to `https://findamine.app`. Add a host to `APP_HOSTS` in `src/lib/native/app-hosts.ts` only if it's a new one.
4. On the Mac: `npm ci && npm run ios:sync`, raise Build, then Archive and upload.

Players stay signed in only if the cookie's host stays the same. Moving hosts signs everyone out once, because the cookie belongs to the old host. That's expected.

## 8. Not done yet

- **Sending pushes.** Tokens are stored, but nothing sends notifications yet. That needs an APNs Auth Key (`.p8`, created in Certificates, IDs & Profiles > Keys with "Apple Push Notifications service" enabled; keep it out of git, `*.p8` is already ignored), stored as a Vercel secret, plus a sender (server route or Supabase Edge Function) that reads `push_devices` and respects `notification_preferences`.
- **Universal links (optional).** These open email links in the app. Serve `/.well-known/apple-app-site-association` from the site with `{"applinks":{"details":[{"appIDs":["<TEAMID>.app.findamine"],"components":[{"/":"/api/auth/confirm*"},{"/":"/*"}]}]}}`, then add **Associated Domains** `applinks:findamine.app` in Xcode. The web side already handles the incoming link (`appUrlOpen` in `src/lib/native/bootstrap.ts`, which only accepts our hosts).
- **"Open Settings" button** on the permission-denied notices. This needs a plugin that can open `app-settings:` (for example `@capacitor/app-launcher`).

## Reference

| Thing | Where |
| --- | --- |
| Site URL, plugins config | `capacitor.config.ts` |
| Allowed hosts | `src/lib/native/app-hosts.ts` |
| Offline / error screen | `ios-shell/offline.html` (`server.errorPath`) |
| Native bridge (web side) | `src/lib/native/*`, `src/components/native/*` |
| Purpose strings | `ios/App/App/Info.plist`, `docs/ios-permission-strings.md` (a test keeps them identical) |
| Push entitlement | `ios/App/App/App.entitlements` |
| Push token forwarding | `ios/App/App/AppDelegate.swift` |
| Icon and splash | `npm run ios:assets` (renders `public/icon.svg` into `ios/App/App/Assets.xcassets`) |
| Device token API + table | `src/app/api/v1/notifications/devices/route.ts`, `supabase/migrations/078_push_devices.sql` |
