---
name: app-shell
description: Give an onboarding-produced app its main shell — a four-tab home with a REAL native iOS tab bar (via @capgo/capacitor-native-navigation pinned 8.3.0; system UITabBar with Liquid Glass on iOS 26+, the plugin's native UIKit floating bar on iOS 15–25) and a liquid-glass web fallback bar for the browser preview. Overlay template applied on top of the onboarding skill's output: copies shell files, splices index.html's home stub into a tab shell with four placeholder screens, fills tab title/icon slots, installs the pinned native dependency. Verification: browser checks (including a rejecting-mock native bridge) always; simulator proof of the native bar when ios/ exists, reported PENDING otherwise.
---

# app-shell — agent instructions

Human-readable rationale: `README.md` in this directory. This file is procedure.

**Structural choice (documented, binding): overlay, not fork.** This skill does NOT ship its own index.html; it extends the onboarding template's output in place. The golden files live in `template/` here: overlay files copied verbatim plus one HTML fragment spliced into index.html. Same tokens, same lifecycle, same rules — one app contains both flows. If the template and any prose disagree, the template wins.

**The sanctioned preview difference.** The shipped app uses a LITERAL native tab bar hosted by `@capgo/capacitor-native-navigation` (bridge name `NativeNavigation`), with two native paths: on **iOS 26+** the plugin hosts the system `UITabBar`/`UITabBarController` and iOS renders its own Liquid Glass; on **iOS 15–25** the plugin draws its own native UIKit floating tab bar — native code and native materials, but not Apple's component. Division of labor: the native layer owns the tab chrome, WebView hosting, content insets, and selection-intent events; the web layer owns all content, pane state, and what a selection *means*. The web glass bar in `shell.css` exists ONLY as the browser-preview fallback. It is explicitly OK — sanctioned — that the bar differs between preview and device; this is the plugin convention's ultimate case (native half via npm + cap sync, JS half vendored, browser fallback always works). Do not try to make the web bar pixel-match the native one, and do not ship the web bar as the device experience. Evidence discipline: a screenshot may be labeled "system Liquid Glass" ONLY if captured on an iOS 26+ runtime — on older runtimes label it as the plugin's native floating bar.

**Fail-safe rule.** The native path is entered in two gated steps, each of which can fall back: (1) `init()` in `vendor/native-tabs.js` resolves `true` only after the full handshake — version probe → configure → listener → hidden setTabbar; (2) `html.native-tabs` (which hides the web bar) is added ONLY after the first successful VISIBLE `setVisible(true)` — both methods return `Promise<boolean>` and log a `[native-tabs]` diagnostic on failure. A native side that breaks at ANY stage keeps the web fallback bar. This is verified per stage, not assumed (Phase E check 11).

## Inputs

Required: an app folder produced by the `onboarding` skill (filled or freshly templated). Optional: four tab names. Ask for nothing; thin input → use the defaults in the slot table.

## Phase A — Copy the overlay files

From `template/` into the app folder:

```
<app>/www/shell.css              (tab shell styles — token-consuming)
<app>/www/shell.js               (tab logic: cuts, scroll preservation, native/web switch)
<app>/www/vendor/native-tabs.js  (fail-safe bridge adapter over Capacitor.Plugins.NativeNavigation)
```

Never modify `style.css`, `app.js`, or `vendor/haptics.js` — the shell is additive.

## Phase B — Splice index.html (idempotent; verify anchors before cutting)

Count first, then act — never splice on unexpected counts:

- **Pristine app** — `<!-- 7 · home stub -->` appears exactly once AND `class="screen shell"` appears zero times → do the three edits below.
- **Already-shelled app** — `class="screen shell"` appears exactly once → verify-and-repair, which must never clobber downstream work: **preserve the existing shell section by default** (later skills and the user's agent build real features into these panes). Repair means normalizing the surroundings — exactly one shell.css `<link>`, exactly one of each shell `<script>` tag, correctly ordered; add what's missing, deduplicate extras. Wholesale replacement of the section is allowed ONLY when (a) it is provably unchanged boilerplate — every pane still consists solely of the template's placeholder content (the `yours-card` and `ghost-card` markup, plus pane 1's plan card/empty-state) with nothing added, removed, or rewritten — or (b) the user explicitly authorizes overwriting it. Otherwise leave the section alone and report what was preserved. NEVER splice a second shell.
- **Anything else** (both anchors present, either anchor duplicated, neither found) → abort and report; the file is not in a state this skill understands.

The three pristine-path edits:

1. After the `<link rel="stylesheet" href="style.css" />` line (exactly one match required), insert:
   `<link rel="stylesheet" href="shell.css" />`
2. Replace the home stub — the block starting at the `<!-- 7 · home stub -->` comment through that section's closing `</section>` — with the full contents of `template/home-shell.html`. **Carry-over rule for already-filled apps:** before replacing, read the existing home section and capture (a) the plan noun (first `.plan-label` text minus the leading `Your `) and (b) the `.empty-state` text; fill them into the fragment's `{{PLAN_NOUN}}` / `{{EMPTY_STATE_LINE}}`. On a fresh template these are filled alongside the onboarding slots as usual.
3. Script order — insert `<script src="vendor/native-tabs.js"></script>` on the line before `<script src="app.js"></script>` (exactly one match required), and `<script src="shell.js"></script>` on the line after it.

`app.js` is untouched: the shell keeps `data-screen="home"` on its outer section, so onboarding's `show("home")`, `fillPlan()` (the `data-plan` spans live in pane 1), and the progress bar all work unchanged.

## Phase C — Fill the slots (and nothing else)

| Slot | Default | Content rule |
|---|---|---|
| `{{TAB1_TITLE}}`…`{{TAB4_TITLE}}` | Home, Progress, Explore, Settings | Short nouns that fit THIS app; tab 1 is always the landing tab |
| `{{TAB1_ICON}}`…`{{TAB4_ICON}}` | home, chart, compass, gear | Web-fallback icon NAME from the sprite library (onboarding's 20 + this skill's additions: `home, compass, gear, user`) |
| `{{TAB1_SF}}`…`{{TAB4_SF}}` | house.fill, chart.bar.fill, safari.fill, gearshape.fill | Valid SF Symbol NAME — this is what the native bar renders; prefer `.fill` variants (iOS tab convention) |
| `{{PLAN_NOUN}}`, `{{EMPTY_STATE_LINE}}` | — | Carried over per the Phase B rule |

Escaping rules are the onboarding skill's: HTML-escape text content; attribute-escape attribute values (`{{TABn_SF}}` sits in a `data-sf` attribute). After filling: `grep -rn "{{" <app>/www/` must be empty, and every `<use href="#i-…">` must reference an existing `<symbol id>` (the supplemental sprite in the fragment counts).

Placeholder pane content (`This screen is yours…` cards, ghost rows) is fixed skeleton — later skills or the user's agent replace whole panes; this skill never writes real features.

## Phase D — Native dependency (this skill owns it; version pinned)

Preconditions: `node --version` ≥ 22 (Capacitor 8 tooling floor) — older → stop and tell the user to upgrade. `package.json` with `@capacitor/core@^8` present (the testflight skill's audit installs the core set); if the app has no package.json yet, `npm init -y` and add `@capacitor/core@^8` alongside the plugin.

1. `npm install --save-exact @capgo/capacitor-native-navigation@8.3.0` — **exact pin, deliberately**: 8.3.0 is the version whose Swift source was audited and sim-verified for this template. Verification asserts the resolved version (`npm ls @capgo/capacitor-native-navigation` → `8.3.0`).
   **Upgrade procedure (never drift silently):** to move off 8.3.0, re-read the new version's `NativeNavigationPlugin.swift` + `definitions.d.ts` for API/behavior changes to `configure`/`setTabbar`/`tabSelect`/inset CSS vars, re-run the full Phase E suite including the simulator proof, then update the pin here AND in this SKILL.md.
2. **Two branches — never claim what the branch can't prove:**
   - `ios/` exists → `npx cap sync ios` — must exit 0 and list `@capgo/capacitor-native-navigation@8.3.0` among synced plugins. Simulator proof (E.12–13) is REQUIRED.
   - `ios/` absent (onboarding-only app; deferred-native branch) → the dependency is recorded in package.json and the later `testflight` run's `cap add ios` + `cap sync` picks it up. Run the browser checks only and report native-bar proof as **PENDING (no native project yet)** — never claim sim or device evidence in this branch.

No pbxproj edits, no extra privacy-manifest entries (the plugin touches no privacy-listed APIs; re-check this when upgrading the pin).

## Phase E — Verify (executable; evidence, then the claim)

Browser checks at BOTH dimensions (320×568, 430×932), both motion modes:

1. `grep -rn "{{" <app>/www/` empty; `<use>`/`<symbol>` diff empty; 14 `section.screen` still present with canonical `data-screen` values; exactly one `class="screen shell"`.
2. Shell structure: 4 `.tab-pane` (ids `pane-tab1..4`, `tabindex="0"`, `aria-labelledby` pointing at `tabbtn-tab1..4`), 4 `.tabbar .tab` with matching ids and `aria-controls`, `role="tablist"`/`tab`/`tabpanel` wiring; the tablist precedes the panels in DOM order (the bar overlays the bottom via CSS positioning) — that ordering is what makes the Tab-key path in check 7 work.
3. Onboarding regression: full walkthrough still reaches home; plan card in pane 1 rehydrates via `fillPlan`.
4. **Glass genuinely samples** (not a static tint): with pane content scrolled to two different offsets, screenshot the tab-bar region — the pixels behind the bar must differ between the two (bar chrome constant, backdrop changing). Computed `backdrop-filter` on `.tabbar` contains `blur`.
5. Tab switch is an instant CUT: no `transition` on `.tab-pane`; the leaving pane hides the same frame the entering one shows. Reduced motion: identical (nothing further to cut); press transform disabled.
6. Scroll preservation: scroll tab 1 down, switch away and back — `scrollTop` unchanged. Panes hide via `visibility` (never `display`), which is what preserves offsets.
7. Web-bar keyboard/focus contract (W3C tabs pattern): activating a tab (click or arrow) keeps focus ON the tab, never moves it into the panel; ArrowLeft/ArrowRight move selection+focus with wrap; ArrowUp/ArrowDown are NOT intercepted (page scrolls normally); roving tabindex holds (selected `0`, others `-1`); Tab from the active tab reaches the active panel — verify by asserting the next tabbable element in document order after the active tab is the active pane (hidden panes are `visibility:hidden`, hence skipped; the tablist-before-panels DOM order is what makes this hold). Native-path focus (pane title focused on `tabSelect`) is code-checked here; actual VoiceOver behavior is pending device verification — say so.
8. Touch targets ≥ 44px on every `.tabbar .tab`; no horizontal scroll; `.pane-scroll` scrolls while `body`/`#screen` stay fixed; content scrolls UNDER the bar (bottom padding clears it).
9. **Safe-area single-ownership:** with mocked nonzero side insets (set `--safe-left`/`--safe-right` to e.g. `40px` on `:root`), the bar's left edge offset inside `#screen` equals `--safe-left + --tabbar-inset-x` applied ONCE (the bar adds only `--tabbar-inset-x` on top of `#screen`'s padding — verify no doubling), and no horizontal scroll appears.
10. Color audit: zero raw colors in `shell.css` below its token block.
11. **Staged rejecting-mock bridge (fail-safe proof, one stage at a time):** serve a throwaway copy of the app where a script BEFORE `vendor/native-tabs.js` installs a mock `window.Capacitor` bridge (`isNativePlatform: () => true`) whose `NativeNavigation` methods succeed EXCEPT one stage selected per run (e.g. via a `?fail=` query param): `version` (getPluginVersion rejects), `configure`, `listener` (addListener rejects), `settabbar-hidden` (setTabbar rejects when `hidden:true`), `settabbar-visible` (setTabbar rejects when `hidden:false`). For EACH stage, reach the shell (activating the shell section directly is acceptable — it exercises the same observer → setVisible path) and assert: web bar visible, `html.native-tabs` NOT set, tabs still switch, `[native-tabs]` diagnostic in the console. Also run the all-pass control: with no stage failing, `html.native-tabs` MUST appear and the web bar hide — this proves the harness itself can reach the native path. The mock copy never ships.

**Simulator — PRIMARY proof of the native bar** (required when `ios/` exists; PENDING otherwise):

12. Build and run on an iOS simulator. Reach the shell, then capture screenshot/recording evidence showing: the REAL native tab bar (not the web capsule) with 4 tabs, SF Symbol icons and titles; tapping tabs switches the web panes; the web `.tabbar` absent (`html.native-tabs` set); pane content insets to `--cap-native-tabbar-height`. Note the runtime version in the report — only an iOS 26+ runtime may be labeled "system Liquid Glass"; older runtimes show the plugin's native floating bar and must be labeled as such.
13. During onboarding screens the native bar is hidden; it appears when the shell screen becomes active (MutationObserver path) — verify in the same sim session.

Then state what remains unproven until device verification: haptic feel on tab switch, glass behavior under real content/dark mode, safe-area interplay on notched hardware, VoiceOver traversal of the native bar, and — symmetrically — whichever native path the sim runtime did NOT exercise: an iOS 26+ sim leaves the iOS 15–25 native floating bar unproven; an iOS 15–25 sim leaves the system Liquid Glass bar unproven. Name the one that applies.
