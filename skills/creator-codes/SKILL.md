---
name: creator-codes
description: Creator-code attribution with no owned backend. A public static codes.json (tiny generated Vercel site — landing stub + JSON + CORS header) is the source of truth; an optional, skippable "Have a creator code?" screen joins the onboarding flow (after plan-building, before social proof — SEQUENCE grows to 15); entered codes persist via Preferences, validate against the fetched list with a timeout, fall back to a PENDING state offline (re-validated next launch — never blocks onboarding, never drops a code); attribution attaches the code to RevenueCat subscriber attributes (setAttributes on the pinned 13.3.0 — CAPPluginReturnNone on the raw bridge, so results are typed "attempted" and re-asserted every launch). The code appears on RevenueCat customer profiles and in Scheduled Data Exports, where revenue-per-creator is computed — zero owned servers.
---

# creator-codes — agent instructions

Human-readable rationale: `README.md` in this directory. This file is procedure.

**Composition.** Applies on top of `onboarding` output; composes with `paywall` (attribution rides its RevenueCat setup) and `app-shell` (no interaction). This is the first skill that edits `app.js` — sanctioned because it changes the FLOW itself (a new step in SEQUENCE), which no overlay can do; the edits are two tightly-anchored one-line splices, nothing else. All other files follow the overlay pattern.

**Why the codes list is public, stated plainly:** creator codes are shared publicly by the creators themselves (that is their entire function). The list holds `{code, creator, handle, active}` — no secrets, no user data — so a public static JSON on a static host is the correct storage: free, cacheable, no auth surface, no owned backend.

**Fail-safe rules (house pattern):** typed results everywhere (`fetchCodes → ok|error`, `attemptAttribution → attempted|deferred|mock|error`, `saveRecord → persisted:…`); the fetch entrypoint is a promise trampoline (synchronous throws become typed errors) with a HARD timeout race that does not depend on AbortController support (the controller additionally cancels the request where available); the codes DOCUMENT is validated strictly — array; every entry has EXACTLY the four public fields `{code, creator, handle, active}` with correct types; codes nonempty, syntax-conforming, unique after normalization — and ANY malformed entry fails the whole document as a typed error, never a silently-empty ok; a fetch failure or missing URL means PENDING, never a blocked user or a dropped submission; navigation is NEVER gated on a network call (the capture-phase persist runs before app.js advances, without stopPropagation); the mock/deferred split follows the paywall adapter's world rules — mock behavior only in a CONFIRMED browser, indeterminate environments defer.

**Attribution honesty (verified against 13.3.0 source):** `setAttributes` is `CAPPluginReturnNone` natively — on the raw bridge it returns `undefined` despite the TypeScript `Promise<void>` type, and it errors natively if configure hasn't run. Therefore: the call is made after a delay that lets the paywall's launch reconcile configure RevenueCat, a no-throw call is typed `attempted` (delivery is not client-confirmable), and attributes are re-asserted on EVERY launch where RevenueCat is available (idempotent server-side). Attributes sent: `creator_code`, `creator_code_status` (`valid|pending|unrecognized`) — both visible on the customer profile and included in Scheduled Data Exports; unvalidated codes are distinguishable there by the status attribute. Only syntax-valid codes and enum-valid statuses ever reach `setAttributes`.

## Conventions

- **Code syntax (enforced in HTML `maxlength`/`pattern` AND in JS, identically):** 2–24 characters of `A–Z 0–9 - _` after trim+uppercase. Nonconforming input is never persisted and never reaches `setAttributes`.
- **Atomic persistence with revision authority:** ONE JSON record `{code, status, name, rev}` under the single key `creator.record`, where `rev` is a monotonic counter (each save writes `max(all revisions seen) + 1`). Writes are layered: a SYNCHRONOUS in-memory + localStorage shadow lands before navigation can proceed, then the Preferences write; a Preferences rejection leaves the shadow standing. `saveRecord` returns a typed result (`persisted: preferences|shadow|memory`), and production callers surface it — never ignore it. `memory` means BOTH durable stores refused: the record lives only until the app terminates; while it exists, durable-write retries run WITHIN the session (interval + next user interaction, stopping on first success), and a termination before any durable store accepts the write loses the record — stated, not hidden. `loadRecord` reads BOTH Preferences and the shadow and the HIGHER revision wins (ties go to Preferences, the durable store); a nonempty shadow newer than Preferences is authoritative until Preferences confirms the same revision, and launch performs a write-through retry until it does. A record with a missing/invalid status reads as `pending`; an invalid code or non-integer revision sanitizes (rev→0) or invalidates the record. `creator.lastAttrib` is a separate diagnostic key. No fire-and-forget writes.
- Codes match case-insensitively on trimmed input; `active: false` entries are known-but-retired and answer as unrecognized.
- The screen is `data-screen="creator"`, spliced between `building` and `proof`; canonical screen count after application: **15** (update any onboarding-derived checks accordingly).

## Phase A — Copy the overlay files (preserve customized files, per house rule)

```
<app>/www/creator.js   <app>/www/creator.css   <app>/www/creator-config.js
```

Existing copies: identical-to-boilerplate → replace; customized → preserve and report. A config holding a real URL is preserved-and-merged.

## Phase B — Splice (idempotent; count anchors first, abort on surprises)

index.html (pristine = each anchor exactly once, no `data-screen="creator"` present; already-applied = creator markers exactly once → verify-and-repair; anything else → abort):

1. Insert `<link rel="stylesheet" href="creator.css" />` after the LAST shell/style stylesheet link (`shell.css` when present, else `style.css`).
2. Insert the full contents of `template/creator-screen.html` immediately BEFORE the `<!-- 4 · social proof` comment.
3. `aria-valuemax="14"` → `aria-valuemax="15"` on the progress track.
4. Scripts: `<script src="creator-config.js"></script>` before the first vendor script; `<script src="creator.js"></script>` as the new LAST script in body.

app.js — the two sanctioned edits, with the SAME state discipline as the index.html rules. Count first:

- **Pristine** = `"building", "proof"` appears exactly once, `"creator"` absent from SEQUENCE, `"creator-next"` absent → apply both edits: (a) SEQUENCE: `"building", "proof"` → `"building", "creator", "proof"` (TOTAL_STEPS derives from SEQUENCE.length — no other progress edit); (b) actions map: insert `"creator-next": function () { haptic.light(); next("creator"); },` immediately before the `"proof-next"` entry (anchor exactly once).
- **Applied** = `"building", "creator", "proof"` exactly once AND exactly one `"creator-next"` entry → verify, touch nothing.
- **Mixed** = exactly one of the two edits present → apply only the missing one, and only if its pristine anchor is exactly-once; otherwise abort.
- **Duplicates** = more than one `"creator-next"` entry or `"creator"` more than once in SEQUENCE → normalize down to exactly one of each ONLY when the duplicates are byte-identical to the sanctioned lines; anything else → abort and report. Never touch unrelated lines.

paywall.js (only when the paywall skill is applied — its private SEQUENCE copy must agree): same SEQUENCE replacement, same pristine/applied/duplicate rules. A present-but-unpatched paywall.js desynchronizes routed-launch progress numbers — treat it as a verification failure.

## Phase C — Fill the slots

| Slot | File | Default | Content rule |
|---|---|---|---|
| `{{CREATOR_ICON}}` | creator-screen.html | heart | Sprite icon NAME — validate it against the TARGET index.html's actual `<symbol id>` list before filling (a typo renders as a blank icon, not an error) |
| `{{CREATOR_HEADLINE}}` | creator-screen.html | Have a creator code? | Screen headline |
| `{{CREATOR_BODY}}` | creator-screen.html | Support the creator who sent you — enter their code. | One or two sentences; no invented perks |
| `{{CREATOR_PLACEHOLDER}}` | creator-screen.html | CODE | Input placeholder — sits in an HTML ATTRIBUTE: attribute-escape it (`& < > "`) |
| `{{CODES_URL_JSON}}` | creator-config.js | `""` | The deployed codes.json URL as a JSON-SERIALIZED string (e.g. `"https://<project>.vercel.app/codes.json"`). Empty until Phase D deploys — the pending model applies and nothing breaks. |

HTML-escape text-content slots; attribute-escape attribute slots. After filling: `grep -rn "{{" <app>/www/` is empty.

## Phase D — The codes site (generate + guided human deploy, apple-setup style)

1. Copy `template/codes-site/` to `<app>/codes-site/` (or a sibling folder the user prefers): `index.html` (landing stub), `codes.json` (the template ships with a single INACTIVE example entry only — replace with the app's real creators), `vercel.json` (**do not drop it** — it sets `Access-Control-Allow-Origin: *` on `/codes.json`; without that header the Capacitor origin's fetch is CORS-blocked and every code sits in pending forever; this was hit live during this skill's verification).
   **Pre-deploy schema check (must pass before any deploy):** validate codes.json against the exact schema — a JSON array; every entry an object with EXACTLY the four fields `code` (string, 2–24 chars `A-Za-z0-9_-`), `creator` (string), `handle` (string), `active` (boolean); normalized codes unique. **No deployable fake codes:** the check FAILS a production deploy if any ACTIVE entry is example data (code starting `EXAMPLE`, or creator containing `Example`).
2. Deployment is a one-time human step — tell the user exactly:

> One-time: `npm i -g vercel` (or use npx), then from the codes-site folder run `vercel` — it will open a browser login the first time (GitHub/email), ask project questions (defaults are all fine), and print the deployment URL. Then run `vercel --prod` to get the stable production URL.
> **Plan honesty:** Vercel's Hobby tier is licensed for personal, non-commercial use (see Vercel's fair-use / Hobby plan terms). An app that charges money is commercial — use Vercel Pro, or any static host whose free tier permits commercial use (e.g. Cloudflare Pages) with the same files; only the CORS-header config file is host-specific.
> Your codes list is now at `https://<project>.vercel.app/codes.json` — open it in a browser to confirm.
> Adding or retiring a creator later: edit `codes.json`, run `vercel --prod` again. That's the whole workflow.

3. After the URL exists: fill `{{CODES_URL_JSON}}` with it (JSON-serialized), re-verify, re-sync. Confirm CORS: `curl -sI https://<project>.vercel.app/codes.json | grep -i access-control` shows the header.

## Phase E — Verify (contract + rejection matrix; evidence, then the claim)

Browser (both dimensions), with a locally served codes.json standing in for the deployed site:

1. Structure: **15** `section.screen`; `creator` sits between `building` and `proof` in the DOM, in app.js SEQUENCE, and (when present) in paywall.js SEQUENCE; `aria-valuemax="15"`; progress on the creator screen reads 11/15.
2. Input rules: computed `font-size` ≥ 16px; text is selectable in the input; touch targets ≥ 44px.
3. Walk: the building screen's plan-reveal **Continue** (`building-next`) lands on creator; Skip → proof with nothing persisted; typed-then-Skip also persists nothing (Skip deliberately does not submit); Continue with empty or nonconforming input submits nothing (nonconforming shows the syntax hint) and still advances.
4. Valid code: live status shows the creator's name; Continue → `creator.code` (normalized), `creator.status = "valid"`, `creator.name` persisted; flow advances the same tick (no await).
5. Unrecognized code: status says not recognized AND the flow still advances; persisted as `unrecognized`.
6. Offline/pending: with the codes URL unreachable (or `""`), an entered code persists as `pending`; on a later launch with the list reachable, status upgrades to `valid`/`unrecognized` — the code is never dropped.
7. Malformed codes.json (non-array / bad entries) → treated as fetch error → pending model; `active: false` codes are rejected as unrecognized.
8. Rejection matrix (harness with `?case=`): fetch timeout (unroutable host) → pending after ~4s, onboarding never blocked — run it ALSO with AbortController removed (the hard race must still resolve); fetch 404/500 → pending; malformed DOCUMENT (bad entry types, unexpected fields, duplicate codes) → typed error → pending, never a silently-empty list; Preferences.set rejecting → saveRecord reports the shadow fallback and the record survives reload from the shadow; oversize/invalid input (>24 chars, illegal characters) → syntax hint shown, nothing persisted, nothing attributed; adapter world checks — confirmed browser → attribution `mock` with the diagnostic; native mock without Purchases bridge or with invalid key → `deferred`; `setAttributes` throwing → typed `error`, no crash; native mock with happy bridge → `attempted` and the attributes payload carries `creator_code` + `creator_code_status` (assert via a capturing mock); re-assertion fires on EVERY launch with a persisted code (counter across two loads).
9. Regression: full onboarding walk to home; paywall behavior unchanged; shell unchanged; `app.js` diff against the template shows EXACTLY the two sanctioned splices (and the build stamp).

Device: the creator screen is plain web — the browser proof carries; what device verification adds is keyboard behavior over the input (no viewport zoom at 18px, done in the standard feel pass). Real attribution end-to-end (code visible on a RevenueCat customer) is verifiable only after the paywall's RC setup is live — report PENDING until then.

Next: `testflight` for the device push.
