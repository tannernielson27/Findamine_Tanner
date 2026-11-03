# Building and publishing the Android app

The Android app is the same Capacitor 8 wrapper as iOS (see `docs/ios-build-on-mac.md`): it loads `APP_URL` from `capacitor.config.ts` (today `https://findamine-tanner.vercel.app`), so **web changes reach Android as soon as Vercel deploys them, with no new build.** You only need a new build when native things change: plugins, permissions, the icon or splash, or `APP_URL`.

It builds on Windows. You don't need a Mac.

## What's different from iOS

- **No push notifications yet.** Android push needs Firebase (a `google-services.json` file plus an FCM sender on the server). Without it, registering for push crashes the app. So `@capacitor/push-notifications` is left out of the Android build (`android.includePlugins` in `capacitor.config.ts`), and `pushSupported()` in `src/lib/native/push.ts` hides the Settings toggle on Android.
- **Status bar.** Capacitor 8's built-in SystemBars handles Android's edge-to-edge screen and the safe-area insets the site already pads for (`plugins.SystemBars`). The `@capacitor/status-bar` plugin is left out of Android because its overlay mode fights that.
- **Camera.** The camera plugin hands off to the phone's camera app, so the app declares no `CAMERA` permission. Location is foreground only. The microphone (`RECORD_AUDIO`) is for spoken challenge answers.

## Build a release bundle

Needs Android Studio, which brings its own Java (`jbr`) and the Android SDK.

```sh
npm ci
npm run android:sync            # writes ios-shell/app-url.js, then `npx cap sync android`
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew.bat bundleRelease
```

The signed bundle is written to `android/app/build/outputs/bundle/release/app-release.aab`. You can also use `npm run android:open` and then **Build > Generate Signed App Bundle** in Android Studio.

**Before every upload, raise `versionCode`** in `android/app/build.gradle` (1, 2, 3 …). Play rejects a number it has already seen. `versionName` is the version people see (for example 1.0, 1.1).

## Signing key

- The **upload key** is `C:/Users/wildd/Desktop/Findamine/android-signing/findamine-upload.jks`, outside the repo. Its password is in `keystore.properties` next to it.
- `android/keystore.properties` (gitignored) points the release build at that key. On another machine, copy both files over.
- **Back up the `.jks` file and its password** in a password manager. With Play App Signing (the default), Google holds the real app-signing key. If the upload key is lost, you can ask Play support to reset it, but that takes days.

## Upload a new version from the command line

After the first release, `npm run android:upload` uploads the bundle through the Play Developer API instead of Play Console.

```sh
npm run android:upload -- --check                         # sign in, show the latest versionCode, change nothing
npm run android:upload -- --notes "Bug fixes"             # upload to production as a draft
npm run android:upload -- --notes "Bug fixes" --submit    # upload and send to Google for review
```

- `--track` picks `production` (the default), `beta`, `alpha` or `internal`. `--aab` picks a different bundle; the default is the `bundleRelease` output.
- Without `--submit` the release is saved as a draft, and you send it from **Publishing overview**. With `--submit` it goes to review, and because Managed publishing is off, it goes live as soon as Google approves it.
- Raise `versionCode` first. `--check` prints the number the next upload needs.

### One-time service account setup

1. In [Google Cloud console](https://console.cloud.google.com/), pick or create a project. Enable the **Google Play Android Developer API** (APIs & Services > Library).
2. Under **IAM & Admin > Service accounts**, create a service account (for example `play-upload`). It needs no Cloud roles.
3. Open the account, go to **Keys > Add key > Create new key > JSON**, and save the file as `C:/Users/wildd/Desktop/Findamine/android-signing/play-service-account.json`. Keep it outside the repo and never commit it. To keep it somewhere else, set `PLAY_SERVICE_ACCOUNT` to its path.
4. In Play Console, go to **Users and permissions > Invite new users**, and enter the service account's email address (it ends in `iam.gserviceaccount.com`). Under **App permissions**, add Findamine with **Release to production, exclude devices, and use Play App Signing** and **Release apps to testing tracks**. Then send the invitation.
5. Run `npm run android:upload -- --check`. New permissions can take up to a day to start working. A 401 or 403 error usually means they haven't yet.

## Icons and splash

`npm run android:assets` renders the launcher icons (adaptive, legacy and round) and the splash screens from `public/icon.svg`, using the same paper and compass as iOS. The output is committed, so you only need to run it when the mark changes.

## First release on Google Play

1. **Developer account:** <https://play.google.com/console>, $25 one time. A *personal* account must run a **closed test with at least 12 testers opted in for 14 days in a row** before it can apply for production. An *organization* account (needs a D-U-N-S number) skips this.
2. **Create app:** name Findamine, App, Free.
3. **Testing > Closed testing:** create a track, upload `app-release.aab`, and add testers by email list or Google Group. Testers must accept the opt-in link and install the app.
4. **App content** (Policy > App content), all required:
   - **Privacy policy:** `https://findamine-tanner.vercel.app/privacy`
   - **Account deletion:** Play needs a *web* link where people can ask to delete their account without the app. Settings has an in-app delete button, but also point to a web page (for example the privacy page's deletion section, or a short page that explains how to delete and gives an email address).
   - **Data safety:** declare what the app collects. Email, name, and user IDs are used for the account. Precise location is used while playing. Photos and audio recordings are submitted as answers. App activity covers hunt progress. Say whether each is shared, that data is encrypted in transit, and that people can ask for deletion. Keep this consistent with the App Store privacy labels.
   - **Target audience and content:** parents can create accounts for children under 13, so be careful here. If you include under-13 age groups, Google's **Families policy** applies (stricter rules on ads, SDKs and data).
   - **Content rating** questionnaire, **ads** (none), and **government app** (no).
5. **Main store listing:** short and full description, the 512×512 icon (reuse `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` resized), a 1024×500 feature graphic, and at least 2 phone screenshots.
6. After the 14-day closed test, use **Apply for production** on the dashboard, then create a production release from the same bundle (or a newer one).
