# Arrival verification: privacy design

Status: 2026-11-13. Fix 1 (location check) is ready to ship. Fix 2 (AI landmark check)
is built behind an off switch and **must not be turned on** until the checklist at the
end is done.

## What changes

1. **Location check on "I'm here".** The arrive endpoint no longer records an arrival
   just because the player tapped the button. It needs a fresh GPS fix within the stop's
   radius, allowing for GPS error.
2. **Photo arrival when GPS is off.** If location is denied or unavailable, the player
   takes a photo at the stop instead. The arrival is recorded as *unverified* and
   flagged for review. The player moves on either way.
3. **AI landmark check (switched off).** When it is on, an AI model looks at a photo and
   says whether the stop's landmark is in it. A "no" or "unsure" flags the arrival for
   review. It never blocks the player.

## Privacy impact of each part

| Part | New data collected | New recipient | Policy change |
|---|---|---|---|
| 1. Location check | GPS accuracy (metres) stored in the arrival metadata | none | none. "Check that you reached each stop" already covers it |
| 2. Photo arrival | none new. Same selfie upload, same private bucket | none | small: say a photo can stand in for location |
| 3. AI check | verdict + confidence per photo | **Anthropic** (photo + stop name/description) | **yes.** Section 4 currently says AI providers never get photos |

Part 3 conflicts with the current policy (`src/app/privacy/page.tsx`, section 4: "We do
not send them your location, photos…"). Apple App Review guideline 5.1.2(i) also
requires telling people, and getting explicit permission, before personal data goes to
a third-party AI. So part 3 is **opt-in**.

## Rules the build follows

- **R1 Opt-in only.** No photo goes to an AI service unless that player said yes in a
  clear notice shown before their first check. Their answer is stored with the notice
  version (`ai_photo_check_choices`). Saying no costs nothing: the photo is just flagged
  for human review.
- **R2 Adults only.** Children's photos never leave the device (COPPA), so they can't be
  checked. Teens are excluded for v1 as well. Neither group ever sees the notice.
- **R3 Minimum data.** The server shrinks the image to at most 1024 px and re-encodes
  it, which removes all metadata (EXIF GPS, device, time). The AI call carries only the
  image and the stop's name and description. It carries no user ID, name, email or
  coordinates.
- **R4 Landmark only.** The prompt tells the model to judge only the landmark and not to
  describe or identify people. The answer is forced into a fixed shape: verdict
  (`match` / `no_match` / `unsure`) and confidence. No free text about the photo is
  stored.
- **R5 Store the verdict, not the conversation.** `find_photos` keeps the verdict,
  confidence, model ID, notice version and time. The raw model response is not stored.
- **R6 Review by Findamine admins only.** Flagged photos are reviewed by admins, not hunt
  creators. That matches today's rule for recordings ("only you and Findamine
  administrators"). The review screen is not built yet; flags are stored now.
- **R7 Off by default.** The AI check runs only when `LANDMARK_PHOTO_CHECK=on` *and*
  `ANTHROPIC_API_KEY` is set. Neither is set in production today.
- **R8 Deletion.** Verdicts live on `find_photos` and choices in
  `ai_photo_check_choices`, both keyed to the user. Account deletion removes both.
- **R9 Not study data.** The opt-in choice and the verdicts are not research measures
  and are left out of every research export.

## Research study note (for Dr. Keith)

The AI-check notice is a privacy decision shown to participants partway through a
privacy study. Every arm sees the same notice, so it doesn't bias one arm against
another. It is still an extra privacy prompt that could prime later choices. Options:

- (a) Keep the switch off until the cohort's data collection ends. **Recommended.**
- (b) Turn it on during the cohort and mention it in the IRB protocol as part of normal
  app operation.

The location check (part 1) and photo arrival (part 2) have no study impact.

## Checklist before turning on the AI check

1. Dr. Keith picks (a) or (b) above. If (b), file an IRB amendment.
2. Check Anthropic's current API data-retention terms and record them here. Consider
   asking for zero data retention.
3. Apply the policy text below and bump `LAST_UPDATED` in `src/lib/constants/legal.ts`.
4. Show existing users an in-app note before it takes effect (policy section 10).
5. Update the App Store privacy answers if needed. Photos are already listed as
   collected. The new part is that a service provider processes them.
6. Set `ANTHROPIC_API_KEY` and `LANDMARK_PHOTO_CHECK=on` in Vercel (Production).

## Draft policy text (apply when switching on)

Section 1, **Photos**, add:

> If you allow it, a photo you take at a stop is checked by an AI service (Anthropic) to
> confirm the stop's landmark is in it. We ask first, and you can say no. Before the
> photo is sent we shrink it and remove its location and other hidden details, and we
> send only the photo and the name of the stop. We keep only the result (whether the
> landmark was found). Photos that can't be confirmed may be looked at by a Findamine
> administrator. Photos from children's and teens' accounts are never checked this way.

Section 1, **Location**, add:

> If location is off or not working, you can take a photo at the stop instead. That
> arrival is marked as not location-checked.

Section 4, replace the Anthropic and OpenAI item with:

> **Anthropic and OpenAI**: AI features that help hunt creators write hunt content, clues
> and hints. These receive hunt and challenge text. If you are an adult and you allow it,
> Anthropic also receives photos you take at stops, with hidden details removed, to
> check the stop's landmark is in them. We do not send them your location, audio, email
> address or contact details.
