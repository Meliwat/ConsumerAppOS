---
name: paywall
description: Make the onboarding template's paywall real. RevenueCat via @revenuecat/purchases-capacitor (pinned 13.3.0, driven over the raw bridge — no ESM), with a vendored adapter enforcing a strict three-world model — store (native+bridge+key), mock (confirmed browser only, fully labeled), unavailable (native context missing key/bridge → explicit unavailable states, never mock success). Typed entitlement results against the single configured entitlement; verified-trial-only language; launch reconcile that grants on verified active, revokes on verified inactive, retains access on errors. Soft gate, documented plainly. Automates ASC subscription setup via the current API schema where supported; guides the human steps exactly. StoreKit configuration file as the zero-ASC simulator lane (with the RevenueCat certificate-upload step). Verification is a staged rejection matrix.
---

# paywall — agent instructions

Human-readable rationale: `README.md` in this directory. This file is procedure.

**Activation, not replacement.** The onboarding template's paywall screen is the finished UI; this skill wires it. `app.js` and the paywall markup stay untouched — `paywall.js` intercepts CTA/Restore clicks in the CAPTURE phase, fills verified data into the existing spans, and routes launches by entitlement state.

**The world model (adapter-enforced, decided lazily per call):**
- `store` — a confirmed native platform + Purchases bridge + a VALIDATED publishable key (`^appl_[A-Za-z0-9]+$` — malformed or secret-shaped values are refused with a diagnostic, in every build).
- `mock` — a CONFIRMED browser only: either no Capacitor object exists at all, or a working `isNativePlatform()` answered exactly `false`. The full flow rehearses with labeled mock data.
- `unavailable` — everything else: a native context missing the key or the bridge, AND any indeterminate environment — missing detector, malformed Capacitor object, detector exception, non-boolean answer. Indeterminate is NEVER mock and NEVER store; money paths return explicit unavailable results.

**No-false-grants rule:** a missing or broken adapter never exposes app.js's CTA path — the gate still intercepts and shows an explicit unavailable state with retry. Entitlement grants come only from: verified purchase, verified restore, verified reconcile, or a labeled mock purchase in a confirmed browser.

**Typed entitlement results (no error-as-denial):** every check inspects EXACTLY `customerInfo.entitlements.active[<configured id>]` (`window.APP_RC_ENTITLEMENT`, slot-driven, default `pro`). `checkEntitlement → active|inactive|unknown`, `restore → restored|none|error` (verified-empty and failure are distinct, with distinct user messages), `purchase → purchased|cancelled|unavailable|unconfirmed|error`.

**Reconcile model (implemented exactly as stated — describe it nowhere else differently):** on launch in store mode the entitlement is re-checked FRESHLY — cache invalidation must SUCCEED before the fetch; if it is missing or fails, the check reports "unknown" (access retained) rather than passing off a possibly-cached answer as fresh. VERIFIED active → grant (+route un-touched sessions to the shell; "un-touched" counts pointer AND keyboard activity). VERIFIED inactive → persist "0" IMMEDIATELY, then route un-touched sessions back to the paywall. unknown/error → RETAIN last-known access. Refunds/expirations are picked up on the next launch that can reach RevenueCat; the app never revokes on a network error. Persisted reads use a timeout default so a slow Preferences bridge can't hang the app, and late responses are APPLIED when they arrive — under an authority rule: the verified store verdict outranks local state, so a late-arriving persisted "1" in store mode triggers reconciliation (or rides an already-verified active verdict) before it may grant or route; no path routes home on stale local state after the store said inactive. In mock/unavailable worlds (no store authority) the local flag is the authority.

**Trial truthfulness:** trial language comes ONLY from a verified state: the product has a zero-price intro AND `checkTrialOrIntroductoryPriceEligibility` returned eligible for it. Unknown or ineligible → standard pricing, no badge (RevenueCat's own recommendation). The CTA label is derived per selection: "Start My Free Trial" only when the SELECTED plan has a verified eligible trial; otherwise "Subscribe" (the activation deliberately rewrites the template's fixed CTA label from verified data — the one sanctioned label override, because money language must be earned).

**Real-data labeling:** the example-offer banner persists until EVERY displayed plan has a validated product id (naming convention), a nonempty localized price, a parseable period, and eligibility-derived language. A plan failing validation is HIDDEN (selection moves to a surviving plan), never shown unlabeled. Mock data always renders with the mock banner text.

**Gate model — soft paywall, documented honestly:** the ✕ close is a real skip that reaches the shell without paying (the onboarding template's design). Entitlement controls launch routing and the persisted `paywall.entitled` flag that later skills read to gate features. Nothing else is protected by this skill. (Hard-gating is a deliberate product change: remove the ✕ in the app and say so — not this skill's default.)

**Purchase-error honesty:** cancellation is recognized ONLY via RevenueCat's explicit signals (`userCancelled === true` or the PURCHASE_CANCELLED code) — never message-text matching. Any other failure re-checks the entitlement first (StoreKit may have charged); if still not active the user sees the neutral "We couldn't confirm your purchase. If you were charged, tap Restore Purchases." — the app NEVER asserts "you weren't charged" after StoreKit was in play.

## Conventions

- Product IDs: `<appId>.pro.yearly`, `<appId>.pro.monthly` (adapter matches by suffix).
- Offering: `default` with `$rc_annual` / `$rc_monthly` packages.
- Persistence keys: `paywall.entitled` ("1"/"0"), `paywall.onboarded`, `paywall.mockPurchased` (mock purchase HISTORY — the mock world's restore answers from this, independently of the entitlement flag, so positive restore is rehearsable).

## Inputs

Required: an app folder produced by `onboarding` (with or without `app-shell`). Optional: the RevenueCat public SDK key. No key → browser previews rehearse the mock flow; native builds show the unavailable state. **Release rule: a TestFlight/App Store build must have a key matching `^appl_[A-Za-z0-9]+$` — verification fails a release with an empty or malformed key.**

## Phase A — Copy the overlay files (preserve customized files)

```
<app>/www/vendor/purchases.js   <app>/www/paywall.js   <app>/www/paywall-config.js
```

Before overwriting an EXISTING copy of any of these: compare it to this skill's template (modulo filled slots). Identical-to-boilerplate → replace with the current template. Differs → PRESERVE it and report, unless the user explicitly authorizes overwrite. `paywall-config.js` holding a real `appl_` key is always preserved-and-merged (never clobbered back to a placeholder).

## Phase B — Splice index.html (idempotent; count anchors first)

Same discipline as app-shell: pristine anchors exactly once → splice; markers present exactly once → verify-and-repair (normalize to exactly one of each tag); anything else → abort.

1. Insert `<script src="paywall-config.js"></script>` and `<script src="vendor/purchases.js"></script>` before `<script src="vendor/haptics.js"></script>` (exactly one match).
2. Insert `<script src="paywall.js"></script>` as the LAST script in body (after `app.js`, after `shell.js` when present).

## Phase C — Fill the slots

| Slot | File | Content rule |
|---|---|---|
| `{{RC_PUBLIC_KEY_JSON}}` | paywall-config.js | The RevenueCat PUBLIC SDK key as a JSON-SERIALIZED string (e.g. `""` or `"appl_xxxx"`) — produce it with a JSON serializer, never by splicing into hand-written quotes. **Validate BEFORE writing any nonempty value:** must match `^appl_[A-Za-z0-9]+$`; anything secret-shaped (`sk_…`, `-----BEGIN`, a .p8 path) is rejected immediately, for every build. Empty → mock (browser) / unavailable (native) worlds apply. |
| `{{RC_ENTITLEMENT_ID_JSON}}` | paywall-config.js | The single entitlement id this app gates on, JSON-serialized (default `"pro"`). Must equal the id created in RevenueCat (F.c). |
| `{{APP_ID}}` | storekit/Products.storekit | Bundle id → product ids `<appId>.pro.yearly/monthly` |

After filling: `grep -rn "{{" <app>/www/ <app>/ios/App/App/Products.storekit` (where present) is empty. **Secret scan (non-echoing) before any run/ship:** scan `www/` for secret patterns (`sk_[A-Za-z0-9]`, `BEGIN PRIVATE KEY`, `AuthKey_.*\.p8`) reporting ONLY file names and match counts — never print the matched content. Any hit → stop.

## Phase D — Native dependency (pinned; bridge quirks documented)

Preconditions: `node --version` ≥ 22; `@capacitor/core@^8` present.

1. `npm install --save-exact @revenuecat/purchases-capacitor@13.3.0` (reference-app-proven AND current, verified 2026-08; also in testflight's B.1 list — pins must match). Upgrade = re-read changelog + definitions for `configure`/`getOfferings`/`purchasePackage`/`restorePurchases`/`checkTrialOrIntroductoryPriceEligibility` changes, re-run Phase G, update both pins together.
2. `ios/` exists → `npx cap sync ios` lists the plugin. Absent → deferred-native branch; report store-path proof PENDING.
3. **Bridge trap:** `configure`/`setLogLevel`/`setEmail` are `CAPPluginReturnNone` — they return `undefined` on the raw bridge; never `.then` them (the adapter encodes this; do not "fix" it).

## Phase E — StoreKit configuration (the zero-ASC simulator lane)

1. Copy `template/storekit/Products.storekit` (slots filled) to `<app>/ios/App/App/Products.storekit` — same preserve rule as Phase A: an existing file that differs from boilerplate is kept unless overwrite is authorized.
2. Wire the shared scheme (`ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` — Capacitor generates no shared scheme; author one if missing, blueprint id from the pbxproj). Inside `<LaunchAction …>`:
   ```xml
   <StoreKitConfigurationFileReference
      identifier = "../App/Products.storekit">
   </StoreKitConfigurationFileReference>
   ```
   The identifier is relative to `App.xcodeproj`. Normalize on every run: exactly ONE `StoreKitConfigurationFileReference` in the LaunchAction — deduplicate extras, correct a wrong path in place. Verify by opening the scheme editor once (Run → Options shows `Products.storekit` selected); if it shows empty, re-select the file there — that UI step also rewrites the path canonically.
3. **Required human step for RevenueCat + StoreKit-config testing** (tell the user; cite RevenueCat's guide "Testing with StoreKit Configuration files", docs.revenuecat.com): in Xcode, open `Products.storekit` → Editor menu → **Save Public Certificate**; then RevenueCat dashboard → the app's settings → StoreKit Configuration / testing section → upload that certificate. Without it the SDK cannot validate local StoreKit-config transactions.
4. **Honest limits:** the scheme's StoreKit configuration applies when RUN FROM XCODE (`simctl launch` does not apply it); offerings still come from RevenueCat's backend, so the sheet needs F.c done (products entered in RC) — what this lane removes is ASC products and sandbox Apple IDs. Fast lane = Xcode Run + RC key + certificate upload. Real lane = sandbox Apple ID on device against real ASC products.

## Phase F — Store setup: automate what the API supports, guide the rest

Official App Store Connect API only (apple-setup credentials; `asc_app_id` from `.testflight.json`). **Fully idempotent: GET first, compare attributes, PATCH where supported, POST only what's absent — never blind-POST.** Show every API response.

**F.a — Paid Applications agreement (human-only; diagnose, don't pattern-match).** No public endpoint exposes agreement state. On any error from F.b, read `errors[].code` and `errors[].detail` — ONLY details naming a missing/expired agreement or contract trigger this instruction:

> App Store Connect → Business (Agreements, Tax, and Banking) → **Paid Apps** → accept, complete banking + tax. Activation takes minutes-to-days.

Other 403s are role/permission problems (see apple-setup's roles note) — say which key/role needs what, don't send the user to the agreement page for a permissions error.

**F.b — Subscription group + products (automated; July-2026 schema, V2 version-scoped).** Idempotency is DESIRED-STATE, not existence-checking: for every resource GET the current attributes AND relationships, diff against the intended state, PATCH mutable mismatches, create replacement resources where that's the supported update path, and REPORT immutable mismatches (e.g. a wrong `productId` or `subscriptionPeriod` cannot be edited — tell the user, never silently create a duplicate). POST only what is genuinely absent.

1. Group: `GET /v1/apps/<asc_app_id>/subscriptionGroups` → `referenceName == "Pro"`; create via `POST /v1/subscriptionGroups` only if absent.
2. **Version scoping (V2 migration):** localizations hang off VERSION resources now, not the group/subscription directly. Discover the group's version via its `subscriptionGroupVersions` relationship (create the initial version if none exists), then read/write the group display name against that version: GET its localizations, `POST /v2/subscriptionGroupLocalizations` (name "Pro", locale `en-US`) with the subscriptionGroupVersion relationship only if absent, PATCH if the name differs.
3. Per plan: `GET /v1/subscriptionGroups/<gid>/subscriptions`, match by `productId`. Create missing via `POST /v1/subscriptions` `{name, productId: "<appId>.pro.yearly|monthly", subscriptionPeriod: "ONE_YEAR"|"ONE_MONTH", groupLevel: 1, familySharable: false}`. Existing-but-different: `name`/`groupLevel`/`familySharable` are PATCHable; `productId`/`subscriptionPeriod` are immutable → report.
4. Subscription display names/descriptions: discover each subscription's `subscriptionVersions` relationship (create the initial version if none), then GET that version's localizations and `POST /v2/subscriptionLocalizations` (with the subscriptionVersion relationship) / PATCH on text mismatch.
5. **Plan availability:** `POST /v1/subscriptionPlanAvailabilities` (the `/v1/subscriptionAvailabilities` resource is deprecated) with `planType: "MONTHLY"` — the schema's two plan types are `MONTHLY` (standard pay-per-renewal-period auto-renewing plans, Apple's name for the recurring-billing shape regardless of period length) and `UPFRONT` (prepaid full-term plans); this skill's subscriptions bill per renewal period, so MONTHLY, for the yearly product too — plus `availableInNewTerritories: true` and the required subscription + territories relationships (all current territories unless the user says otherwise). GET the existing plan availability first; diff `planType`, `availableInNewTerritories`, AND the territory set; PATCH/recreate on mismatch.
6. **Pricing, equalized — not USA-only:** pick the BASE territory price point (`GET /v1/subscriptions/<id>/pricePoints?filter[territory]=USA` → the point matching the intended price; confirm the price with the user first), then `GET /v1/subscriptionPricePoints/<pointId>/equalizations`, then create subscription prices from the base point + equalized points (batch POSTs to `/v1/subscriptionPrices`). Desired-state: GET existing prices with their price points and schedules; matching territory+point → skip; territory priced differently → create the replacement price (price changes are new scheduled prices, not PATCHes) and report the schedule Apple applies.
7. Free trial on yearly: GET existing introductory offers WITH their terms; matching `{offerMode: "FREE_TRIAL", duration: "THREE_DAYS", numberOfPeriods: 1}` → skip; different terms → delete-and-recreate (offer terms are not PATCHable) and say so; absent → `POST /v1/subscriptionIntroductoryOffers` with exactly those attributes + the subscription relationship (omit territory relationships to apply across the subscription's territories).
8. Still human: the agreement (F.a), review screenshot + submitting products for review (release flow), price confirmation.

**F.c — RevenueCat dashboard (human-only, once per app; exact clicks).** Tell the user:

> 1. app.revenuecat.com → create/select the project → **Apps** → + New → Apple App Store → App name `<appName>`, Bundle ID `<appId>`.
> 2. In-app purchase key: App Store Connect → Users and Access → Integrations → In-App Purchase → generate/download the .p8 → upload to RevenueCat with Key ID + Issuer ID (lives in RC's backend; never ships).
> 3. Product catalog → + New: `<appId>.pro.yearly`, `<appId>.pro.monthly`.
> 4. Entitlements → + New → id **`<the {{RC_ENTITLEMENT_ID}} value>`** → attach both products.
> 5. Offerings → `default` → package `$rc_annual` → yearly, `$rc_monthly` → monthly.
> 6. API keys → copy the **Public app-specific key** (`appl_…`) → that goes in `www/paywall-config.js`. (For simulator StoreKit-config testing, also do the certificate upload from Phase E.3.)

Key hygiene, verbatim: `appl_` ships; `sk_`, `.p8`, shared secrets never touch the repo or bundle.

## Phase G — Verify (staged rejection matrix; evidence, then the claim)

Browser baseline (mock world, both dimensions): placeholders → labeled mock prices; verified-trial CTA language per selection ("Start My Free Trial" only on the trial-eligible selection, "Subscribe" otherwise); purchase busy-state → grant → app.js navigation; entitled/onboarded launch routing; ✕ skip + gate holds on reload; entitled CTA passthrough; `app.js` untouched (diff).

**Rejection matrix** — a staged harness (throwaway copy, `?case=` param) that mocks `window.Capacitor` (native context) and fails ONE stage per run. For each case assert: no grant occurs, no navigation to home happens via the CTA, `paywall.entitled` unset, and the stated user-visible state appears. Cases:

| # | Case | Required behavior |
|---|---|---|
| 1 | adapter script missing | CTA/Restore blocked with unavailable toast; ✕ still skips |
| 2 | native, no Purchases bridge | mode `unavailable`; CTA → unavailable toast; NEVER mock data or mock success |
| 3 | native, empty key | same as 2 |
| 3a | Capacitor present, `isNativePlatform` MISSING (malformed) | mode `unavailable` — indeterminate is never mock |
| 3b | `isNativePlatform` THROWS | mode `unavailable` — a broken detector is never mock |
| 3c | key present but malformed/secret-shaped | mode `unavailable` + diagnostic; the value is refused in every build |
| 4 | configure throws | offerings rejected → placeholders + banner stay; CTA → unavailable |
| 5 | getOfferings rejects | placeholders + banner stay; retry on next arrival |
| 6 | offerings partial (one bad plan) | bad plan HIDDEN, selection moves; banner off only if all VISIBLE plans validate |
| 7 | eligibility rejects | prices render, NO trial badge, CTA "Subscribe" |
| 8 | purchase rejects (non-cancel code) | entitlement re-checked; inactive → neutral unconfirmed message; no grant |
| 9 | purchase rejects (userCancelled) | silent; CTA restored; no message, no grant |
| 10 | purchase rejects but entitlement re-check ACTIVE | treated as purchased (grant + navigate) |
| 11 | restore rejects | "couldn't check" message — distinct from verified-empty |
| 12 | restore verified-empty | "No purchases to restore." |
| 13 | launch: persisted entitled, CustomerInfo VERIFIED inactive | "0" persisted immediately; un-touched session routed to paywall |
| 14 | launch: persisted entitled, CustomerInfo rejects | access RETAINED (stays home) |
| 15 | Preferences rejects / hangs | app boots on defaults; a LATE response is applied (entitled late-arrival routes home in local-authority worlds) |
| 15a | LATE persisted "1" arrives AFTER a verified-inactive store verdict | NO route home on the stale flag — reconciliation runs and the store verdict stands |
| + | mock restore positive | after mock purchase history exists (independent key), restore → restored without pre-set entitlement |
| + | all-pass store control | full store-mock happy path: real-shaped data renders, banner OFF, purchase grants — proves the harness reaches the store path |

Release check: `APP_RC_KEY` matches `^appl_[A-Za-z0-9]+$` before any TestFlight/App Store build; empty → fail the release step. Dev builds may ship an empty key — in the browser that's the labeled mock world, on native it is the explicit UNAVAILABLE state (native never enters the mock world). A malformed or secret-shaped value is refused at runtime in every build, dev included.

Sim/device: build with the RC pod; boots clean; native-without-key shows the unavailable state (not mock). StoreKit sheet: Xcode Run + RC key + certificate — report PENDING with the exact blocking human steps until then. Unverified until live products: real prices/currencies, eligibility on real accounts, sandbox renewals, restore against a real Apple ID.

Next: `testflight` once verification is green.
