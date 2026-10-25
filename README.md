# MannaGrams

MannaGrams is your daily Bible word game, with 4 to 6 letter answers.

The responsive web app can be installed from a supported browser and keeps
working offline after its first successful load. Existing player progress is
preserved under the original browser storage key.

## Local development

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173`.

## Tests

```bash
npm run test:e2e
npm run test:unit
```

## GitHub Pages

This repo includes a GitHub Actions workflow that deploys the static app to GitHub Pages on every push to `main`.
Only the runtime files in `dist/` are published.

## Code layout

- `app.js`: rendering and events
- `game-engine.mjs`: letter scoring and keyboard state
- `progress-store.mjs`: saved games, statistics, backup validation and merging
- `sharing.mjs`: text and image results
- `entitlements.mjs`: Premium access and guess allowances
- `archive.mjs`: past-date calendar and archive selection
- `native.mjs`: Android file and result sharing

## Moving progress

Open **Menu → Move or back up progress → Export progress** on the existing
website. Save the JSON file, then select it under **Import progress backup**
in the same menu in the Android app.
Completed games already on the destination are kept. Reimporting a backup does
not double-count games. Backups contain game history, never subscription rights.
Android export opens the system share sheet; choose a file destination.
New backups include archive progress separately. Backups from the earlier web
version can still be imported without removing archive history.

## Puzzle archive

Open the hamburger menu for help, statistics, and the streak calendar. Month
arrows navigate dates beginning March 1, 2026. Tap a date for its status and,
for a completed game, the saved guesses. The answer is shown for solved games.
Missed and unfinished days show their status and cannot be played or resumed.
Future dates cannot be selected.

Saved history survives reloads and offline use. The calendar shows solved and
unsolved completed games. Day details open over the menu, keeping today's game
intact. History never changes daily statistics, win streaks, or play streaks.
History is included in the current test build; its access check will use
verified Premium/trial entitlements when billing is connected.
The `today` date override is available only in a local browser preview, never in
the Android app or published website.

For an interactive phone-sized preview in Codex, run the app server and open
`phone-preview.html`. This development-only page is excluded from Android and
Pages builds. Its screen-size selector includes phones and tablets in portrait
and landscape, using the same game layout at each selected viewport size.

The compact header shows the date at the top right and the word length/guess
allowance below the subtitle. Grid squares adapt to available width and height,
including after rotation or completion. Tablet tiles are capped to avoid
oversized squares. Short landscape phones place the keyboard beside the grid.
At widths of at least 760px and heights of at least 600px, help, stats and the
calendar stay visible in a sidebar beside the game. Narrower or shorter windows
use the slide-out menu, including when a tablet switches to a narrow split view.
Keys remain at least 44px tall and tiles at least 32px; exceptionally short or
zoomed views can scroll rather than shrinking below these limits.

## Android testing

The Capacitor app bundles the game and word lists and does not depend on GitHub
Pages being available. Its package ID is `com.gwest1000.mannagrams`.

```bash
npm ci
npm run android:sync
npm run android:open
```

Local compilation requires Java 21 and Android SDK 36 (or a compatible Android
Studio installation). The **Android test build** GitHub Actions workflow builds
a debug APK and saves it as the `MannaGrams-Android-test` artifact. This is a
testing build, not a signed Play Store release. Export progress before replacing
a debug installation with a store installation; their signing keys differ.

## Premium release plan

Approved pricing: $0.99/month; confirm the base currency when configuring Play.
Premium and the 30-day trial receive 6/7/8 guesses for 4/5/6-letter words.
Free receives 4/5/6. Each started game's limit is retained across entitlement
changes; legacy games retain their original allowance.

Current web and Android test builds grant full testing access. They do not start
a trial, charge money, display ads, or enforce Premium restrictions. The access
policy is tested, but needs verified Play subscription state before activation.

Remaining release dependencies:

1. Configure the developer account and app in Play Console, signing, and the
   subscription with its trial; integrate verified purchases, restore, and cancellation.
2. Connect verified access checks and an ad provider. Complete
   the store listing, privacy policy, data safety declarations and pricing disclosures.
3. Test on Android devices, including native sharing, importing web history,
   offline launches, purchases, expiry, and refunds. Complete required Play testing.
4. Publish production only after these checks and existing-player migration.
5. Disable Pages and its deployment workflow, then make the repository private.
   Those last steps are deliberately pending migration and production release.
