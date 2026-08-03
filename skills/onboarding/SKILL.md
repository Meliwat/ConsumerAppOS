---
name: onboarding
description: Scaffold a complete, previewable app shell with a consumer onboarding flow by copying this skill's canonical template and filling enumerated content slots (app name + one-line description; optionally an App Store link or screenshot for theming). Fixed skeleton lives in template files, not prose. Output is vanilla HTML/CSS/JS under www/, Capacitor 8-ready, no build step. Ends with an executable verification pass at two phone dimensions.
---

# onboarding — agent instructions

Human-readable rationale: `README.md` in this directory. This file is procedure.

**The template IS the structure.** The golden files live in `template/` in this skill's directory. You copy them and fill slots; you never author screen markup, flow logic, or native-feel CSS yourself, and you never add, remove, or reorder anything structural. If the template and any prose disagree, the template wins — fix the prose.

## Inputs

Required: app name, one-line description. Optional: App Store link or screenshot (theming input only).

**Bundle-ID namespace** — ask once per user (persist if a config location exists), offering default `com.<owner name, lowercased, ASCII letters/digits only>`. Validate before use: the namespace must match `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$` (reverse-DNS: lowercase alphanumeric labels, no label starting with a digit, dots between labels). Invalid input → show the rule, re-ask; never proceed with an invalid or placeholder ID.

**App slug (deterministic, no implementation-dependent behavior):**
1. Lowercase the app name.
2. Transliterate: Unicode NFD normalize, strip combining marks (diacritics), then DROP any remaining non-ASCII characters.
3. Keep only `[a-z0-9]`.
4. If the result starts with a digit, prefix `app`.
5. If the result is EMPTY, fall back to `app` and require explicit user confirmation of the resulting `appId` before continuing.

`{{APP_ID}} = <namespace>.<slug>`.

Ask for nothing else. Thin description → write the best generic content for the app's category; do not go back with questions.

## Phase A — Copy the template

Copy `template/` into the target folder:

```
<target>/www/index.html
<target>/www/style.css
<target>/www/app.js
<target>/www/vendor/haptics.js    (vendored plugin wrapper — see the plugin convention below)
<target>/capacitor.config.json    (from template/capacitor.config.json — root, NOT in www/)
```

**Plugin convention (haptics is its first use).** Native plugin JS never arrives via ESM imports — a browser can't resolve them and there's no bundler. Instead: the *native* side is installed by the `testflight` skill (`@capacitor/haptics@^8`, npm + `cap sync`); the *JS* side is a browser-ready wrapper checked into `www/vendor/` and loaded as a plain `<script>` tag. The wrapper (`vendor/haptics.js`) uses the natively-injected bridge (`window.Capacitor.Plugins.Haptics`) when present and falls back to `navigator.vibrate`/no-op in the browser — the preview must never error, and haptics must never break the app (every call guarded). Haptic wiring in the flow is fixed template behavior: light impact on quiz answers and screen-advance CTAs, success notification on plan reveal and the purchase CTA.

`www/` is exactly what `npx cap sync` ships. No bundler, no build step, ever.

**Scope note (state it in your report):** this skill does NOT init native projects. `npx cap add ios`, installing `@capacitor/splash-screen` and `@capacitor/preferences` (npm + vendor bundles per repo convention), and **portrait lock via `UISupportedInterfaceOrientations`** are required outputs of the later native-packaging skill. The SplashScreen config block is inert until that plugin is installed. (The shell CSS already handles `env(safe-area-inset-left/right)`, so side insets are safe even before the lock exists — both measures are required, not either.)

## Phase B — Fill the slots (and nothing else)

Every `{{SLOT}}` in the copied files must be replaced. Full slot table:

| Slot | File(s) | Content rule |
|---|---|---|
| `{{APP_NAME}}` | index.html, capacitor.config.json | Verbatim app name |
| `{{APP_ID}}` | capacitor.config.json | Per the namespace + slug algorithm |
| `{{BG_HEX}}` | capacitor.config.json | MUST equal the final `--bg` token value (mismatch flashes at launch) |
| `{{HERO_ICON}}` | index.html | Icon NAME from the sprite library (below) |
| `{{PROMISE_LINE}}` | index.html | One-sentence value promise |
| `{{Q1_TEXT}}`…`{{Q7_TEXT}}` | index.html | 7 questions that read as personalization for THIS app, never a survey |
| `{{Qn_OPTm_ICON}}` (28: 7×4) | index.html | Icon NAME from the sprite library per option (reuse across screens fine; keep distinct within one question) |
| `{{Qn_OPTm_TEXT}}` (28: 7×4) | index.html | Short answer options |
| `{{AFFIRM_ICON}}` | index.html | Icon NAME for the affirmation interstitial |
| `{{AFFIRM_HEADLINE}}` | index.html | "You're in the right place"-style beat between quiz and plan-building |
| `{{AFFIRM_BODY}}` | index.html | Value framing ONLY — must not assert invented statistics or fake research claims (truthfulness rule applies) |
| `{{PLAN_NOUN}}` | index.html | plan / program / setup / routine — whatever fits |
| `{{BUILD_STEP_1..4}}` | index.html | Four checklist lines for the building sequence — curated from the app description, referencing the user's quiz answers where natural (count and mechanics are fixed skeleton) |
| `{{TESTIMONIAL_1..3}}` | index.html | Category-plausible EXAMPLE copy — the template's `Example review` tags and mock banner must remain |
| `{{NOTIFY_BENEFIT}}` | index.html | Why reminders help, one or two sentences |
| `{{FEATURE_1..4}}` | index.html | Paywall feature checklist |
| `{{TRIAL_DURATION}}` | index.html | e.g. `3 days` — offer language is a slot precisely because it's concrete; it renders under the paywall's example-offer banner until real pricing is wired |
| `{{EMPTY_STATE_LINE}}` | index.html | e.g. "This is where [app] begins" |

**Context-safe substitution (no raw textual replacement):**

- Slots in HTML **text content** (questions, testimonials, promise, features…): HTML-escape the value (`& < > ` at minimum) before inserting.
- Slots in HTML **attributes** (none currently — rule stands for future attribute slots): attribute-escape (`& < > "`).
- Slots in **capacitor.config.json**: produce the value via JSON serialization (e.g. load the template as JSON, set fields, dump) — never string-splice into JSON.
- `{{BG_HEX}}`: validate it matches `^#[0-9a-fA-F]{6}$` before substitution; reject anything else.

**Icon system.** No emoji anywhere in the shell. Icons are inline SVG via a fixed `<symbol>`/`<use>` sprite at the top of `index.html` — single stroke style, `currentColor` (so theming flows through tokens), sized in CSS. The sprite is template structure; only icon *choices* are slots. Available names: `droplet, bolt, sparkle, cup, waves, sunrise, monitor, moon, bell, leaf, target, chart, star, check, x, chevron-left, clock, heart, trophy, calendar`. Structural icons (`chevron-left` back, `x` close, `star` rating, `check` features, `bell` notify) are fixed, not slots. An icon-name slot must match a sprite symbol exactly — verify with the check below.

After filling: `grep -rn "{{" <target>/` must return nothing, and every `<use href="#i-…">` in the filled index.html must reference an existing `<symbol id>` (grep both lists and diff — a typo'd icon name renders as blank, not an error).

**Truthfulness invariants (survive all filling and theming):** the proof screen's `Example review` tags, the `Loved by [N] users — example figure` count line, the paywall's example-offer banner, and the `$--.--` placeholder prices stay exactly as templated. Restore Purchases is an explicitly inert mock — tapping it shows the template's toast ("Restore is wired up by the payments skill…") and navigates nowhere. Nothing this skill outputs may be shippable as false social proof or invented prices/offers.

## Phase C — Theming (token values only)

All look-and-feel flows through the `:root` token block at the top of `style.css`. The default is a polished, iOS-neutral light theme — with no theming input, change nothing.

Link/screenshot input → adjust token VALUES (palette, type scale, spacing, radius) and copy tone in the slots. Never touch structure, counts, labels, or any CSS below the token block — every color in the file is a token (`--on-accent`, `--star`, `--island`, `--preview-bg`, `--grad-start/--grad-end`, …), so "theming = tokens only" is literal. Contrast contract when changing palette tokens: `--ink` AND `--muted` ≥ 4.5:1 on `--bg`, `--card`, and (for `--muted`, which colors mock tags/banners) `--sel-bg`; `--on-accent` ≥ 4.5:1 on BOTH `--grad-start` and `--grad-end` (measure the gradient's worst end, not its average); `--sel-border` ≥ 3:1 on `--bg` (focus indicator). Update `{{BG_HEX}}` to match any `--bg` change.

## Phase D — Verify (executable; evidence, then the claim)

Preconditions:

1. `test -f <target>/www/index.html` — must pass.
2. `python3 -c "import json;json.load(open('<target>/capacitor.config.json'))"` — valid JSON; `appId` matches `<namespace>.<slug>`; both `backgroundColor` values equal `--bg`.
3. `grep -rn "{{" <target>/` — empty.

Preview serving: `file://` is acceptable for all executable checks below; to hand the user a tappable preview, serve the app folder with `python3 -m http.server <port>` and give them the URL.

Walkthrough at TWO dimensions — compact (320×568) and large (430×932). Run these as actual checks (console/computed values, not eyeballing) and report per-check results:

4. Structure invariant: **14** `section.screen` with canonical `data-screen` values (`welcome, q1…q7, affirm, building, proof, notify, paywall, home`) — quiz questions are REAL screens using the one shared push lifecycle (there is no separate intra-quiz switch mechanism; a second transition code path is a defect); 4 options per question screen; 3 testimonial cards; 4 paywall features; fixed CTA labels verbatim (`Get Started`, `Continue`, `Enable Reminders`, `Maybe Later`, `Start My Free Trial`, `Restore Purchases`).
5. Every path reaches home: quiz is SELECT + CONTINUE — tapping an option selects it (visual + `aria-pressed`, changeable until Continue); each question screen has its OWN Continue — visually disabled (and announced disabled) until an option is picked THIS SESSION; a question always FIRST arrives unselected even when a persisted answer exists (restored answers may pre-select only when navigating back to a question answered this session); back chevrons mirror the push (entering screen slides in from the LEFT, leaving slides right; reduced-motion cut is direction-agnostic); affirm advances on its Continue; building runs its checklist then auto-advances; both notify buttons; paywall CTA and ✕. The notify and proof screens keep their own interactions — select+continue applies to quiz questions ONLY. **Include Restore in the walkthrough:** tap it on the paywall — the toast appears, no navigation occurs.
6. Touch targets: **per screen, while that screen is `.active`** (hidden screens measure 0×0), every visible `button`'s bounding box ≥ 44px in both dimensions; report the smallest found per screen. A screen with no buttons (home) passes vacuously — report it as `no-buttons`, not a failure.
7. Inputs (if any) computed `font-size` ≥ 16px.
8. No horizontal scroll at either dimension (`scrollWidth <= clientWidth` on the scrolling element and `#screen`).
9. Inner scrolling: an overflowing `.screen-body` scrolls; `body` does not. If no screen's content overflows at the test dimensions, the check is vacuous — force a shorter viewport (e.g. 320×400) until a body overflows, then prove it scrolls while the page stays fixed.
10. Persistence: complete the quiz, reload, walk to building/home — the chosen options rehydrate by name (plan card and recap).
11. Selection chrome: computed `user-select` is `none` on headings/buttons, `text` on inputs.
12. Color audit: scan `www/` for `#hex`, `rgb(`, `hsl(`, CSS named colors, and inline `style=` color declarations outside the `:root` token block. The invariant is ZERO raw colors below the token block — every color in the template is a token, so any hit is a violation.
13. Accessibility invariants, executed not assumed:
    - After each screen transition, `document.activeElement` is the new screen's heading.
    - `.progress-track` exposes `role="progressbar"` with `aria-valuemax="14"`, and `aria-valuenow` tracks the current step on every screen change (step = 1 + index in the screen sequence: welcome 1, q1–q7 → 2–8, affirm 9, building 10, proof 11, notify 12, paywall 13, home 14) with the fill width matching `valuenow/14`.
    - A `:focus-visible` rule exists and renders (focus a button via keyboard, confirm the outline — including on a heading: the suppression rule is `:not(:focus-visible)`-scoped, so keyboard focus must still show a ring).
    - Price options: the wrapper exposes `role="radiogroup"`, each price `role="radio"`, `aria-checked` flips on selection, roving tabindex holds (selected option `tabindex="0"`, others `-1` — one tab stop for the group), and Arrow keys (Left/Right/Up/Down) move both selection and focus between options.
    - Quiz options: `aria-pressed` is `true` on the selected option and restored selections re-expose it after reload.
    - Restore toast: `#toast` is a permanent `aria-live` region (never `[hidden]`-toggled) and tapping Restore Purchases populates it — verify the text lands inside the live region.
    - Reduced motion: emulate `prefers-reduced-motion: reduce` (DevTools rendering emulation — `matchMedia` is read at load, so reload after toggling), confirm the building screen skips the ring animation and reveals the plan instantly, and screen changes are CLEAN INSTANT CUTS — leaving screen hidden the same frame the entering one shows, no fade/dim/slide, progress unanimated (reduced motion = cut, not fade; entrance choreography and the building checklist appear instantly at end state).
14. Entrance choreography: after each push completes (never during it), the entering screen's `.screen-body`/`.cta-bar` children compose in DOM order — heading first, ~30ms stagger, 10px rise + fade (200ms), CTA last; the cascade OVERLAPS the push tail (starts ~60% through the ~260ms push — no frame of empty screen); elements are interactive throughout (tap one mid-cascade); the `choreo` classes and inline `transition-delay`s are removed after the cascade (press physics back to 90ms).
15. Press physics: every tappable (`.btn`, back, close) scales ~0.97 (0.92 for the round buttons) on `:active` with 90ms ease-out and springs back on release; GPU transforms only; no hover-dependent styles anywhere.
16. Building checklist + ring: exactly 4 `.build-step` lines resolve strictly in order — rise in, spinner beat, checkmark — light haptic hook per resolve and success on the last; the circular progress ring (SVG dashoffset, accent stroke, percentage label centered) fills CONTINUOUSLY via a rAF tween across the whole sequence — the center number counts through every integer, never pausing or jumping between resolves — and reaches exactly 100% as the final checkmark resolves; the plan reveal fires off the final check (~260ms after); total sequence ~2.5–3.5s. Reduced motion: all four lines render instantly WITH checkmarks and the ring renders complete (100%), one short beat (~500ms), advance — no spinners, no fake waiting.
17. Mock-labeling renders: `Example review` tags, example count line, example-offer banner, placeholder prices.
18. Contrast, computed not eyeballed: calculate WCAG ratios from the actual token values for `--ink`/`--muted` on `--bg` and `--card` (≥ 4.5:1), `--muted` on `--sel-bg` for mock tags/banners (≥ 4.5:1), `--on-accent` on `--grad-start` AND `--grad-end` (≥ 4.5:1 each), `--sel-border` on `--bg` (≥ 3:1, focus indicator).

Do not claim completion without all checks at both sizes. Then state what the browser CANNOT prove — device verification must later confirm: real full-bleed and safe-area insets (top/bottom AND side) on a notched device, rubber-band/momentum behavior, pinch/double-tap zoom suppression (`zoomEnabled` + viewport), keyboard-over-input behavior, portrait lock once native-packaging adds it, VoiceOver traversal, splash-to-app background continuity.
