# iOS permission purpose strings

These are in `ios/App/App/Info.plist` (Capacitor iOS project; `src/__tests__/native-config.test.ts` fails if the two drift). App Review (guideline 5.1.1) reads them next to the in-app primers, so the wording matches `PRIMER_COPY` in `src/lib/permissions/primer.ts`. If you change one, change the other.

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Findamine uses your location while the app is open to sort hunts by distance, show you on the map and tell you when you've reached a stop. It saves where you checked in at each stop and never tracks you in the background.</string>

<key>NSCameraUsageDescription</key>
<string>Findamine uses your camera when you tap Take Photo, so you can take a geo-selfie at a stop or photograph something for a challenge. Geo-selfies are stored privately with your hunt.</string>

<key>NSMicrophoneUsageDescription</key>
<string>Findamine uses your microphone only when you choose to record a spoken answer to a challenge. Recording stops when you tap Stop Recording, and the recording is saved privately with your answer.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>Findamine lets you choose a photo from your library instead of taking a new one for a geo-selfie or photo challenge. It only sees the photo you pick.</string>
```

## What each one covers in the code

| Key | Where it's used | When the OS prompt can appear |
| --- | --- | --- |
| `NSLocationWhenInUseUsageDescription` | `watchLocation` / `getCurrentLocation` in `src/lib/native/geolocation.ts` (`navigator.geolocation` on the web, `@capacitor/geolocation` in the iOS app), called from `src/lib/play/use-geo-tracking.ts` (Play navigate step) `src/components/explore/explore-controls.tsx` (Explore "Near me" chip) and `src/components/hunts/find-editor.tsx` ("Use my current location" for creators) | Play and Explore "Near me": only after the player taps Continue on the location primer. Explore also reads the position silently if permission was already granted. Creator: only after tapping "Use my current location". |
| `NSCameraUsageDescription` | `PhotoPicker` (`src/components/native/photo-picker.tsx`) on the play page's Geo-Selfie step and in the photo challenge (`src/components/play/challenge-input.tsx`): `<input type="file" accept="image/*" capture="environment">` on the web, `@capacitor/camera` `takePhoto` in the iOS app | iOS app: only after the player taps Take Photo / "Tap to take a photo" and then Continue on the camera primer. Web: when the browser's picker opens the camera. |
| `NSMicrophoneUsageDescription` | `navigator.mediaDevices.getUserMedia({ audio: true })` in the audio-response challenge (`challenge-input.tsx`) | Only after the player taps Start Recording and then Continue on the microphone primer. |
| `NSPhotoLibraryUsageDescription` | Same file inputs as the camera on the web; "Choose from library" (`@capacitor/camera` `chooseFromGallery`) in the iOS app | iOS's picker can offer the photo library. The modern picker doesn't strictly need this key, but declaring it avoids a crash or rejection if a library-access path is ever hit. |

## Background location: not used

Findamine never uses location in the background. Do not add `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`, or a `location` entry in `UIBackgroundModes`. Declaring them without a real need is itself a rejection reason.

What the code shows (checked 2026-10-15):

- The only continuous location use is one `watchLocation` call (a `watchPosition` underneath). It starts when the navigate step is on screen and the player has agreed, and `clearWatch` runs as soon as the step changes or the page unmounts.
- The only other call is a one-shot `getCurrentPosition` from a creator's button press.
- `@capacitor/geolocation` is used only for those two foreground calls (checked 2026-10-16). There's no background-geolocation plugin, no service-worker location use, and no `UIBackgroundModes` configuration in the repo.

## Notes for the native build

- **Microphone:** for teen and adult accounts the recording is uploaded by `POST /api/v1/play/[huntId]/audio` to the private `challenge-audio` bucket (migration 075) under `<user_id>/`, and the submitted answer references it (`[audio:Ns:<path>]`). Playback is through 5-minute signed URLs, for the player and admins only. Children's recordings stay on the device (`[audio:Ns:local]`). iOS Safari and WKWebView record `audio/mp4`; the route accepts that alongside `audio/webm` and `audio/ogg`. The purpose string and the primer both say the recording is saved; if that changes, update both.
- **Camera and `vercel.json`:** the `Permissions-Policy` header sets `camera=()`. That blocks `getUserMedia({ video })` but not the native file-input camera that Findamine uses, so the current flows still work. If a live in-page camera is ever added, change it to `camera=(self)`.
- **"Open Settings" button:** the denied notices tell iOS players to go to Settings > Findamine. A button that deep-links there needs a native plugin, such as `@capacitor/app` with `App.openUrl({ url: 'app-settings:' })` or a native-settings plugin. That isn't added yet.
- **Notifications:** there's no purpose string for push. The iOS prompt appears only when the player taps "Turn on notifications" in Settings (iOS app only, never for child accounts) and then Continue on the notifications primer (PRIMER_COPY.notifications). Nothing asks on first launch.
