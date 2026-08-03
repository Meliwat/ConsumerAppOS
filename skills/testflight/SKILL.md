---
name: testflight
description: Put the current build on the owner's phone via TestFlight in one invocation. First run per app: audit/init the native iOS project (Capacitor 8 pinned, portrait lock, splash + preferences plugins with privacy manifest), register the bundle ID via the official App Store Connect API, and walk the user through the one-time app-record website step. Every run: unique build number from ASC, archive + export with automatic signing (persisted Team ID), altool upload with the apple-setup API key, two-stage processing confirmation, deterministic owner-group distribution. Three delivery lanes: wireless devicectl direct install (seconds, the dev loop), TestFlight (minutes, anyone), cable + Xcode (fallback).
---

# testflight — agent instructions

Human-readable rationale: `README.md` in this directory. This file is procedure.

Dependencies: `apple-setup` has run (credentials at `~/.appstoreconnect/config.json`); the app folder has `capacitor.config.json` and `www/` (the `onboarding` output shape). All ASC calls use the OFFICIAL API with the stored key — never Apple ID sessions or private endpoints.

Tooling reality (verified on Xcode 26.4 / altool 26.30.4 locally, 2026-08): `xcrun altool --upload-app` ships with `--apiKey`/`--apiIssuer` and auto-searches `~/.appstoreconnect/private_keys/`. Export method is `app-store-connect` (`app-store` deprecated). Fallbacks are fully specified in Phase G.

Persisted per-app state: keep a small `.testflight.json` in the app folder (gitignored if secret-adjacent; it isn't — team ID and app Apple ID are non-secret) holding `team_id`, `asc_app_id`. Write it as facts are learned; read it before re-deriving.

## Phase A — Preflight (every run)

1. `~/.appstoreconnect/config.json` → `key_id`, `issuer_id`, `key_path`. Missing → stop: "run apple-setup".
2. App's `capacitor.config.json` → `appId`, `appName`; `www/index.html` exists. Placeholder appId → stop.
3. `node --version` ≥ 22 — Capacitor 8 tooling requires it; older → stop and tell the user to upgrade.
4. Xcode ready: `xcodebuild -version` succeeds and `xcodebuild -checkFirstLaunchStatus` exits 0 (else `xcodebuild -runFirstLaunch` — may need sudo; tell the user).
5. Keychain usable for signing: `security show-keychain-info login.keychain-db` exits 0 (unlocked). Locked/headless → stop; signing will silently hang otherwise.
6. **Team ID** (before any archive): resolve in this order and persist to `.testflight.json`:
   a. Already persisted in `.testflight.json` → use it.
   b. `team_id` field in `~/.appstoreconnect/config.json` (apple-setup persists it there; if absent, add it after a one-time user confirmation) → use it.
   c. Existing project: `xcodebuild -showBuildSettings "$XC_KIND" "$XC_PATH" -scheme App 2>/dev/null | grep DEVELOPMENT_TEAM` — non-empty → use it.
   d. Last resort: ask the user to read it from ASC Membership. Do NOT use `xcrun altool --list-providers` with the API key — verified on Xcode 26.4 (first live run): it rejects API-key auth with `AuthenticationFailure("list-providers does not support APIKey authentication.")`.
7. Permissions note (check on first 403 from signing APIs): automatic signing needs the key's role to reach Certificates, Identifiers & Profiles. Per [Apple's program roles](https://developer.apple.com/support/roles/), App Manager requires the additional "Access to Certificates, Identifiers & Profiles" permission — if provisioning calls 403, tell the user to grant it to the key's role in Users and Access (or use an Admin key).
8. Certificate quota awareness: Apple caps Distribution certificates (2 per type). If archive fails with a quota error, do NOT revoke anything — list certs via `GET /v1/certificates?filter[certificateType]=DISTRIBUTION` and ask the user which to reuse/revoke.

## Phase B — Native project: audit and repair (idempotent; never "skip if ios/ exists")

Run every item; create/fix only what's missing or wrong.

1. `package.json` exists (`npm init -y` if not). Dependencies present and **pinned to the same major**: `@capacitor/core@^8`, `@capacitor/cli@^8`, `@capacitor/ios@^8`, `@capacitor/splash-screen@^8`, `@capacitor/preferences@^8`, `@capacitor/haptics@^8` (Preferences and Haptics are deferred here by `onboarding` — this is where their native halves land; the JS halves are vendored in `www/vendor/` per the repo plugin convention). When the app has the `paywall` skill applied (or will), also ensure `@revenuecat/purchases-capacitor@13.3.0` — EXACT pin, audited by the paywall skill; keep the two skills' pins identical. If any @capacitor/* resolves to a different major, fix the ranges and reinstall — never let one package drift to 9.
2. `ios/` missing → `npx cap add ios`. **Workspace vs project — detect, don't assume** (live-run finding): Capacitor 8 defaults to Swift Package Manager, generating `ios/App/App.xcodeproj` + a `CapApp-SPM` local package and NO `App.xcworkspace`; a workspace exists only on CocoaPods-based projects. Set once and use everywhere xcodebuild runs:
   ```
   if [ -d ios/App/App.xcworkspace ]; then XC_KIND=-workspace XC_PATH=ios/App/App.xcworkspace
   else XC_KIND=-project XC_PATH=ios/App/App.xcodeproj; fi
   # invoke as: xcodebuild "$XC_KIND" "$XC_PATH" -scheme App ...
   ```
   Two variables, not one string — a single `$XC_TARGET` word-splits under bash but NOT under zsh, where xcodebuild receives `-project ios/App/App.xcodeproj` as one invalid argument and exits 64 (hit live on this skill's wireless-lane run).
   Then, and also for pre-existing projects, verify:
   - The chosen `$XC_PATH` exists (neither present = broken checkout → `npx cap sync ios`, re-check).
   - `PRODUCT_BUNDLE_IDENTIFIER` in `ios/App/App.xcodeproj/project.pbxproj` equals `appId` — mismatch → fix the pbxproj value.
   - Signing: `CODE_SIGN_STYLE = Automatic` and `DEVELOPMENT_TEAM = <team_id>` in the pbxproj (set if absent; also passed on the command line in Phase F — both, so Xcode-GUI builds work too).
3. **Portrait lock** — fresh Capacitor templates target iPad too, and iPad ignores the iPhone orientation array. Either constrain the family or lock both arrays; default:
   - `plutil -replace UISupportedInterfaceOrientations -json '["UIInterfaceOrientationPortrait"]' ios/App/App/Info.plist`
   - AND set `TARGETED_DEVICE_FAMILY = 1` (iPhone-only) in the pbxproj — the repo's apps are portrait iPhone apps. If the user wants iPad, lock `UISupportedInterfaceOrientations~ipad` to portrait instead of changing family.
4. **Privacy manifest** (required for `@capacitor/preferences` — it touches UserDefaults): ensure `ios/App/App/PrivacyInfo.xcprivacy` exists and declares:
   ```xml
   <key>NSPrivacyAccessedAPITypes</key>
   <array><dict>
     <key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryUserDefaults</string>
     <key>NSPrivacyAccessedAPITypeReasons</key><array><string>CA92.1</string></array>
   </dict></array>
   ```
   (CA92.1 = app accesses its own UserDefaults.) A fresh Capacitor 8 template has ZERO PrivacyInfo references (live-run finding), so creating the file is not enough — wire it into `project.pbxproj` with three anchored insertions: a `PBXFileReference` entry, a `PBXBuildFile` entry referencing it, its ref in the App group's `children` list (anchor on the `AppDelegate.swift` child line), and the build-file ref in the `PBXResourcesBuildPhase` `files` list. Use two fresh 24-hex IDs; verify with `grep -c PrivacyInfo project.pbxproj` (expect ≥ 4 references + smoke build still green).
5. **Export compliance**: if — and only if — the app uses no non-exempt encryption (HTTPS/ATS only is exempt), set `ITSAppUsesNonExemptEncryption` = `false` in Info.plist so uploads don't stall on the compliance question. If the app ships its own crypto, do NOT set it — stop and tell the user compliance needs real answers.
6. `npx cap sync ios` — must exit 0.
7. **Simulator smoke check** — exit status must be xcodebuild's, and the log must survive for diagnosis:
   ```
   set -o pipefail
   xcodebuild "$XC_KIND" "$XC_PATH" -scheme App \
     -destination 'generic/platform=iOS Simulator' build > build/smoke.log 2>&1
   echo "exit: $?"; tail -20 build/smoke.log
   ```
   (Log to file first; tail afterwards — never `xcodebuild | tail` bare, which reports tail's exit status.) Non-zero → stop; read `build/smoke.log` for the compile error; do not proceed to signing with a broken project.

## Phase C — Bundle ID registration (official API; idempotent)

JWT minted from the stored key (apple-setup's verifier pattern):

1. `GET /v1/bundleIds?filter[identifier]=<appId>` — **exact-match** `identifier` in the results (the filter prefix-matches).
2. Found → report "already registered"; continue. Do NOT gate on `platform == "IOS"` — ASC normalizes registrations to `platform: "UNIVERSAL"` even when `IOS` was posted (live-run finding); accept `IOS` or `UNIVERSAL`.
3. Absent → `POST /v1/bundleIds` `{"data":{"type":"bundleIds","attributes":{"identifier":"<appId>","name":"<appName>","platform":"IOS"}}}` → re-GET to confirm. Show the API response either way.

## Phase D — App record (website, human-only, once per app's lifetime)

`GET /v1/apps?filter[bundleId]=<appId>` (exact-match again). Exists → persist its numeric id as `asc_app_id`, skip.

Otherwise tell the user exactly this, then WAIT:

> App Store Connect → My Apps → **+** → New App:
> - Platform: **iOS**
> - Name: **<appName>** (public name — changeable if taken)
> - Primary language: **English (U.S.)** (or preference)
> - Bundle ID: select **<appId>** (just registered; refresh if absent)
> - SKU: **<slug>** (internal, never user-visible)
> - Full Access

After confirmation, re-GET, persist `asc_app_id`.

## Phase E — Versioning (every run)

1. Marketing version: `MARKETING_VERSION` from the pbxproj (default 1.0; fresh Capacitor templates use `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` in Info.plist, so **the build settings are the source of truth — agvtool alone is insufficient**).
2. Unique build number from ASC, not local state:
   `GET /v1/builds?filter[app]=<asc_app_id>&filter[preReleaseVersion.version]=<marketing>&fields[builds]=version&limit=200` → next build number = (max integer `version` found, else 0) + 1.
3. Set it: `CURRENT_PROJECT_VERSION=<n>` — persist into the pbxproj (`sed`-free: `xcrun agvtool new-version -all <n>` works when the project uses apple-generic versioning; otherwise edit the two `CURRENT_PROJECT_VERSION` entries in the pbxproj) AND pass it explicitly on the archive command line (belt and suspenders).

## Phase F — Archive + export (every run)

Paths are build-number-specific so runs never clobber each other: `build/<version>-<n>/`.

1. Refresh web bundle (app's copy step), `npx cap sync ios`.
2. Archive:
   ```
   set -o pipefail
   xcodebuild "$XC_KIND" "$XC_PATH" -scheme App -configuration Release \
     -archivePath "build/<v>-<n>/App.xcarchive" archive \
     -allowProvisioningUpdates \
     DEVELOPMENT_TEAM=<team_id> CURRENT_PROJECT_VERSION=<n> \
     -authenticationKeyPath <key_path> -authenticationKeyID <key_id> -authenticationKeyIssuerID <issuer_id> \
     > "build/<v>-<n>/archive.log" 2>&1
   ```
   First run may trigger a Keychain prompt for the new Distribution cert — tell the user to click Always Allow.
3. **Verify the archive's identity before export**: read `build/<v>-<n>/App.xcarchive/Info.plist` with `plutil -p` (NOT `plutil -extract … json` — the archive plist contains date values that aren't JSON-serializable and the json extraction fails; live-run finding) → `ApplicationProperties` must show `CFBundleIdentifier` = appId, `CFBundleShortVersionString` = marketing version, `CFBundleVersion` = `<n>`. Mismatch → stop; the version didn't take. (The archive may show a Development `SigningIdentity` — export re-signs for distribution; not an error.)
4. Export with `exportOptions.plist`: `method: app-store-connect`, `signingStyle: automatic`, `teamID: <team_id>`:
   ```
   xcodebuild -exportArchive -archivePath "build/<v>-<n>/App.xcarchive" \
     -exportPath "build/<v>-<n>/export" -exportOptionsPlist exportOptions.plist \
     -allowProvisioningUpdates \
     -authenticationKeyPath <key_path> -authenticationKeyID <key_id> -authenticationKeyIssuerID <issuer_id> \
     > "build/<v>-<n>/export.log" 2>&1
   ```
5. **Discover the .ipa by glob**, never by assumed name: `ls build/<v>-<n>/export/*.ipa` — exactly one match expected; zero or several → stop and read export.log.

## Phase G — Upload

Primary:
```
xcrun altool --upload-app -f <the .ipa> -t ios \
  --apiKey <key_id> --apiIssuer <issuer_id> --output-format json
```
Show the real JSON output.

Fallback 1 — `--upload-package` (if `--upload-app` disappears from `xcrun altool --help`); all metadata is already known:
```
xcrun altool --upload-package <the .ipa> --type ios \
  --apple-id <asc_app_id> --bundle-id <appId> \
  --bundle-version <n> --bundle-short-version-string <marketing> \
  --apiKey <key_id> --apiIssuer <issuer_id> --output-format json
```
(On multi-team accounts add `--asc-public-id` from `xcrun altool --list-providers ... --output-format json`.)

Fallback 2 — iTMSTransporter, an actual command not a hand-wave:
```
xcrun iTMSTransporter -m upload -assetFile <the .ipa> \
  -apiKey <key_id> -apiIssuer <issuer_id> -v informational
```
If all three fail, report the preserved error bodies and stop — do not fall back to Apple ID auth.

## Phase H — Confirm processing (two-stage; evidence, then the claim)

Match by version attributes, never newest-first: poll
`GET /v1/builds?filter[app]=<asc_app_id>&filter[preReleaseVersion.version]=<marketing>&filter[version]=<n>`

- **Stage 1 — shipped**: the build appears with `processingState` `PROCESSING` (or already `VALID` — first live run: appeared ~2.5 min after upload, already VALID). This is the documented "shipped" milestone — show this API response. Poll with backoff, cap ~15 min for appearance; absent after cap → report honestly + offer the cable fallback. When scripting the poll, never truncate the JSON you are about to parse (a truncated response parses as an error and reads as a false failure; live-run lesson).
- **Stage 2 — installable**: keep polling until `VALID` before any group assignment. `FAILED` or `INVALID` → explicit failure: fetch the build's details, preserve Apple's error body, report; do not retry blindly (usually a binary issue — missing icon, bad Info.plist, compliance).

## Phase I — Deliver to the owner (deterministic, idempotent)

1. Owner group: `GET /v1/betaGroups?filter[app]=<asc_app_id>&filter[isInternalGroup]=true` → look for name `Owner (private)`. Absent → create:
   ```json
   POST /v1/betaGroups
   {"data":{"type":"betaGroups",
     "attributes":{"name":"Owner (private)","isInternalGroup":true,"hasAccessToAllBuilds":false},
     "relationships":{"app":{"data":{"type":"apps","id":"<asc_app_id>"}}}}}
   ```
   `hasAccessToAllBuilds: false` deliberately — explicit per-build assignment keeps distribution intentional. (If an existing internal group has `hasAccessToAllBuilds: true`, builds flow automatically — then skip step 3 but still verify membership.)
2. Verify the owner is IN the group: `GET /v1/betaGroups/<gid>/betaTesters` must include the owner's email. Absent → this is a **one-time-per-group human step**; the API cannot do it (live-run finding: `POST /v1/betaGroups/<gid>/relationships/betaTesters` with an existing betaTester record returns `409 STATE_ERROR "Tester(s) cannot be assigned"` — internal-group membership only works through the UI). Print exactly:
   > App Store Connect → <app> → **TestFlight** → **Internal Testing** → **<group name>** → **+** next to Testers → select <owner email> → Add.
   Then wait for confirmation and re-GET to verify.
3. Assign the build (idempotent — re-POSTing an existing relationship is safe; treat 409 "already exists" as success):
   ```json
   POST /v1/betaGroups/<gid>/relationships/builds
   {"data":[{"type":"builds","id":"<build id>"}]}
   ```
4. The 204 is not the evidence — **re-read** `GET /v1/betaGroups/<gid>/relationships/builds` and confirm the build id is present. Then tell the user: the build is live for the Owner group; TestFlight on the phone shows it now (internal groups skip beta review).

## Three lanes — when to use which

| Lane | Latency | Reaches | Use when |
|---|---|---|---|
| **Wireless direct install** (below) | seconds | the owner's paired devices | the dev loop — feel every iteration on your own phone |
| **TestFlight** (Phases C–I) | minutes | anyone in a beta group | sharing, beta testers, install-without-a-Mac |
| **Cable + Xcode** | seconds | the plugged-in phone | fallback when Wi-Fi install or ASC is misbehaving |

## Wireless direct install (the instant dev loop)

Commands verified live on Xcode 26.4 (this skill's first live run installed and launched a real app this way).

**One-time setup per device**: pair via cable in Xcode → Window → Devices and Simulators, tick **Connect via network**, trust the computer on the phone, enable Developer Mode (Settings → Privacy & Security). Thereafter the phone appears over Wi-Fi.

**Every iteration:**

1. Find the device: `xcrun devicectl list devices` → grab the UUID of the owner's phone where State is `available (paired)`. (The command may print a harmless provisioning-parameter warning above the table — ignore it.)
2. Refresh + build a development-signed .app (Debug, automatic signing, same auth flags as Phase F):
   ```
   npx cap sync ios
   xcodebuild "$XC_KIND" "$XC_PATH" -scheme App -configuration Debug \
     -destination 'id=<device-uuid>' -allowProvisioningUpdates \
     -authenticationKeyPath <key_path> -authenticationKeyID <key_id> -authenticationKeyIssuerID <issuer_id> \
     build > build/device.log 2>&1
   ```
3. Locate the product from build settings, never a guessed path:
   `xcodebuild "$XC_KIND" "$XC_PATH" -scheme App -configuration Debug -destination 'id=<uuid>' -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR =/{d=$3} / FULL_PRODUCT_NAME =/{n=$3} END{print d"/"n}'`
4. Install: `xcrun devicectl device install app --device <uuid> <path-to-.app>` — success prints the bundleID and an `installationURL`.
5. Launch: `xcrun devicectl device process launch --device <uuid> <bundle-id>`. Known failure: a locked phone returns `FBSOpenApplicationErrorDomain error 7 (Locked)` — the install already succeeded; tell the user to unlock and either tap the icon or let you relaunch.

## Cable + Xcode (fallback)

`npx cap sync ios && open ios/App/App.xcworkspace` (or `open ios/App/App.xcodeproj` on SPM projects — see the `$XC_KIND`/`$XC_PATH` rule), select the plugged-in phone, Run. Same one-time device setup as above. Offer it whenever the wireless lane misbehaves or Phase H exceeds its polling cap.

## Failure matrix

| Failure | Meaning | Action |
|---|---|---|
| API 401 | JWT/credential/clock | Re-run apple-setup verification; check system clock |
| API 403 | Role/permission | Signing/provisioning APIs → the roles note in A.7; TestFlight APIs → key role too low |
| API 409 | Conflict/duplicate | On bundle-ID create: re-GET, it likely exists (treat as idempotent success). On relationships: already assigned → success |
| API 422 | Malformed entity | Preserve Apple's `errors[].detail`; fix the payload — don't retry unchanged |
| Archive: compile errors in log | Code problem | Show the failing section of archive.log; stop |
| Archive: "No signing certificate" / "No profiles for" | Signing bootstrap | Confirm team ID (A.6), roles (A.7), keychain unlocked (A.5); retry once with `-allowProvisioningUpdates` |
| Archive: cert quota ("maximum number of certificates") | Distribution cert cap | A.8 — list, ask the user, never auto-revoke |
| Export failure | exportOptions/signing | Read export.log; commonest: wrong method name or missing teamID |
| altool: auth error | Key/issuer mismatch | Verify key_id/issuer_id pair; altool must find `AuthKey_<key_id>.p8` in `~/.appstoreconnect/private_keys` |
| altool: validation error (JSON `product-errors`) | Binary rejected pre-processing | Preserve the JSON error body; commonest: duplicate build number (redo Phase E), missing icon |
| Build `FAILED`/`INVALID` in H | Rejected during processing | Fetch build details, preserve error body, report; usually binary metadata |

Always preserve Apple's error bodies verbatim in the report — minus any credential material (never echo the key path contents; IDs are non-secret).

## Verification contract

"Shipped" = the ASC API shows THIS build (matched by app + marketing version + build number) in `PROCESSING`/`VALID` — show that response. "Delivered" = the build id confirmed present in the Owner group's builds relationship after assignment. Tool exit codes are necessary, never sufficient.

**First live run: completed 2026-08-02/03 on Xcode 26.4** (app: Sipwell, com.meliwat.sipwell). Verified end-to-end: audit/repair on a fresh Cap 8 SPM project, bundle-ID registration (201), archive→export→altool upload (delivery UUID returned), build VALID ~2.5 min after upload, group creation + build assignment with relationship re-read, and the wireless devicectl install/launch lane. Still unverified: first-run Distribution-cert creation on a machine with no existing cert (this machine had one), agvtool on apple-generic-versioned projects (pbxproj editing was used), and CocoaPods-based (`-workspace`) projects end-to-end. Report those honestly if encountered.
