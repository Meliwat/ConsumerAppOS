---
name: apple-setup
description: One-time Apple foundation setup — request App Store Connect API access if needed, create an API key, store it safely, and verify with a direct authenticated call to Apple's official API. Idempotent — on an already-configured machine it verifies and repairs instead of re-running setup. Run once per Apple developer account; after this, routine app operations (bundle-ID registration, TestFlight uploads, metadata) run without opening App Store Connect. App-record creation and account-level admin stay on the website by design.
---

# apple-setup

This is the foundation skill. You run it once per Apple developer account, and it's the only setup this OS ever asks for. After it, the routine operations — registering bundle IDs, uploading builds, managing TestFlight and metadata — run through Apple's official API without you opening App Store Connect.

Be clear about the boundary, because it's a design choice, not a limitation to apologize for: **everything the official API supports gets automated; everything it doesn't stays a website task.** That means two things remain manual. Account-level admin (program agreements, tax and banking, the API-access approval itself) — Apple deliberately keeps those human. And **creating a new app record**: the official API doesn't offer it, so when a later skill needs an app to exist in App Store Connect, that's a ~3-minute website visit, once per app's lifetime. We build only on the API Apple publicly commits to — tooling that rides Apple's private web endpoints breaks whenever Apple changes them, and this OS doesn't build on things that break on someone else's schedule.

## Why Apple auth works the way it does

Apple gives you two ways to prove who you are to their developer machinery:

1. **Your Apple ID** — email, password, and a 2FA prompt on your device. This is how a human logs in. It's deliberately hostile to automation: the 2FA prompt exists precisely so a script can't be you.
2. **An App Store Connect API key** — a `.p8` private key file. Your tools use it to sign short-lived JWTs (normally at most 20 minutes per token; the `.p8` itself persists until you revoke it), and Apple's official API accepts those tokens as proof. No password, no 2FA, no session to keep alive. This is how a machine logs in, and Apple built it specifically so automated tools can do real work unattended.

The API key is the right choice for everything we automate: a key has a **role** you choose at creation, it's **revocable** with one click without touching your Apple ID, and it never expires on its own. Understand this model and you can rebuild this whole skill from scratch — everything below is just careful handling of one private key.

## First: check whether this machine is already set up

Before touching anything, look for existing credentials: the `.p8` key file(s) and `~/.appstoreconnect/config.json`. If anything is present, this run is **verify-and-repair, not re-setup**.

Verification order matters: **the full security audit from Step 2 runs first, then the auth check.** A credential that authenticates but sits world-readable or inside a repo is not "passing". Concretely, before any network call, recheck for each present piece:

- Ownership (yours) and permissions: 600 on the files, 700 on `~/.appstoreconnect` and `private_keys`.
- Regular-file status and symlinks — including the *individual credential files*, not just the directories (`test -L` on each path).
- Canonical location outside any git worktree (`git -C ~/.appstoreconnect rev-parse --git-dir` must fail).
- Ignore rules present in the session's repos, and the required config fields populated (`key_id`, `issuer_id`, `key_path`).

**Expect more than one `.p8`.** A machine that's shipped apps before usually has several keys accumulated (the first live run of this skill found four). Don't assume a single key: inventory them all, then identify which one is *the* key — the one `config.json` points at, or failing that, the one whose ID appears in existing tooling config (env files, CI config). Verify that key authenticates (Step 3) before touching anything else. The leftovers get retirement guidance, not deletion: once the working key is verified, revoke the stale ones in App Store Connect → Integrations at the owner's pace — they're unaudited credential surface until then, but revoking is an owner decision, never something to do unprompted.

**One symlink case is fine — the one this skill actually met in the wild.** If the working key's real home is a pre-existing directory with dependents (other projects' env files pointing at it), the correct repair is to point `config.json` at the **real path** and leave the dependents intact. Wholesale relocation is not required and would break things that work. The reject rule stands for what it was written for: *unexplained or untrusted* symlinks, where you can't account for who created the link or what the target is.

Repair only what's actually broken. An auth failure gets diagnosed per Step 3 (credential/clock vs role/access) before anything is recreated; recreation is for a key that's genuinely dead, missing, or has the **wrong role** — Apple doesn't allow editing a Team Key's access level after creation, and in every recreation case you create and *verify* the replacement first, then revoke the old one. Never overwrite a working key "to be safe" — a working credential replaced is a working credential destroyed (the old `.p8` can't be re-downloaded). If everything passes, say so with the output and stop.

Why this path is first-class rather than a footnote: setup skills get re-run on already-configured machines *constantly*. An idempotent skill turns a configured machine into a test case instead of an obstacle; a naive one turns it into a pile of revoked keys and duplicate credentials.

## Step 0 — Make sure the account can use the API at all

A brand-new team can't create keys yet. Per [Apple's App Store Connect API get-started doc](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api): the **Account Holder** must first go to **Users and Access → Integrations**, click **Request Access**, agree to the API terms, and submit. Requests are reviewed case by case, so there may be a wait before Team Keys can be generated. If you don't see a Team Keys section, this is why.

Separately: unsigned account agreements (the Apple Developer Program License Agreement, or pending paid-apps agreements) can block app creation and submissions later. If App Store Connect is showing you an agreements banner, resolve it now — it's a human-and-website task, and no key gets around it.

## Step 1 — Create the API key (the one manual step)

Creating credentials is exactly the kind of action Apple refuses to let credentials perform, so this step needs you at the keyboard on the website:

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access** → **Integrations** → **App Store Connect API** (generating team keys requires the Account Holder or an Admin).
2. Under **Team Keys**, click **Generate API Key**.
3. Name it something you'll recognize later (e.g. `consumerappos-agent`), and give it the **App Manager** role. Choose carefully: a Team Key's access level is immutable — Apple doesn't let you edit the role afterwards, so a wrong role means creating a replacement key and revoking this one.
4. **Download the `.p8` file.** Apple lets you download it exactly once — they don't keep a copy you can re-fetch. If you lose it, you revoke and re-create; you never "recover" it.
5. Capture two identifiers from the same page: the **Key ID** (shown next to your new key) and the **Issuer ID** (shown at the top, one per team).

**What this key can actually do — be honest with yourself about the threat model.** App Manager is the least-privileged role that covers full app management: bundle IDs, app metadata, builds, TestFlight distribution, and some user-and-access management. And a team key is **team-wide**: it applies to your *entire* app portfolio and cannot be scoped to a single app. The real contrast with Admin is about ceilings, not app scope — Admin adds account-level powers automation here never needs. If this key leaks, assume the holder can manage every app on the account and distribute builds; revoke it immediately in Integrations. The `.p8`, Key ID, and Issuer ID together are the complete credential.

## Step 2 — Store the credentials (a deterministic procedure, not a vibe)

Target layout:

- `.p8` → `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`
- IDs → `~/.appstoreconnect/config.json`

Why this location: `~/.appstoreconnect/private_keys/` is the directory Apple's `altool`/Transporter search by default, so it's the closest thing to a platform convention for this file (note `notarytool` does *not* auto-search it — it takes an explicit `--key` path; the convention still gives us one canonical, out-of-repo home everything else gets pointed at).

The procedure — each check is mandatory, in order:

1. `umask 077` for the session, so nothing below is ever created world-readable.
2. Create the directories: `mkdir -p ~/.appstoreconnect/private_keys && chmod 700 ~/.appstoreconnect ~/.appstoreconnect/private_keys`.
3. Reject symlinks: if `~/.appstoreconnect` or `private_keys` is a symlink (`test -L`), stop and investigate — a symlinked credential dir can silently relocate secrets somewhere you didn't audit. (The blessed exception for a working key with dependents is described in the detect-existing section.)
4. Verify the canonical dir is outside any git worktree: `git -C ~/.appstoreconnect rev-parse --git-dir` must **fail**. If it succeeds, someone made the home directory (or an ancestor) a repo — stop and resolve before storing anything.
5. **Move the downloaded `.p8` by pathname**: `mv ~/Downloads/AuthKey_<KEYID>.p8 ~/.appstoreconnect/private_keys/`. Never read the file's *contents* into a tool call, chat message, or transcript — the private key should transit as a file rename, nothing else.
6. Confirm no duplicate remains: check `~/Downloads` (and the browser's download history location if it differs) for any remaining `AuthKey_*.p8` copy.
7. Write `~/.appstoreconnect/config.json` with a file-writing tool (not `echo`/heredoc in a shell, which lands in history), then `chmod 600` it and the `.p8`:

   ```json
   {
     "key_id": "ABC123XYZ",
     "issuer_id": "12345678-aaaa-bbbb-cccc-1234567890ab",
     "key_path": "/Users/you/.appstoreconnect/private_keys/AuthKey_ABC123XYZ.p8"
   }
   ```

   Write `key_path` as an absolute path — `~` works only if every consumer remembers to expand it, and one that doesn't fails confusingly. These three fields are the whole credential reference; later skills read this file instead of asking you again, and the file can grow fields later if a future skill needs them.
8. In every repo this OS touches, ensure ignore patterns exist for `*.p8` and `AuthKey_*.p8`, and run a secret scan over both tracked *and* untracked files, in two passes: a **filename scan** (anything matching `*.p8` / `AuthKey_*`) and a **content scan** for private-key headers (`BEGIN PRIVATE KEY`) and credential-shaped strings. The scan reports *matching filenames only* — it must never print the matched contents, or the scan itself becomes the leak. One known benign match: this very file. The skill documents the search patterns it tells you to use, so a content scan of this repo will flag `skills/apple-setup/SKILL.md` — a hit on a markdown file that merely *names* the pattern is documentation, not a leak; a hit on anything else gets investigated.

Never in a repo, never in code, never in shell history — those aren't recommendations; the steps above are how each one is enforced. Why this much ceremony for a local file: the `.p8` is unrecoverable by design, irreplaceable without a manual trip to the website, and — as the secret half of the credential, usable with its Key ID and Issuer ID — the piece that makes App-Manager access over your whole portfolio possible. It's the single most sensitive file this OS handles.

## Step 3 — Verify with real output (no claiming success)

Setup isn't done because the files exist — it's done when the key demonstrably authenticates against Apple's production API. Don't report success until Apple answers.

The verification is deliberately direct: a small script that mints the JWT itself from the stored `.p8` + Key ID + Issuer ID and calls `GET /v1/bundleIds` — no toolchain between you and Apple's auth, which is the point. You see exactly what "authenticating to Apple as a machine" *is*: a signed token in a header, nothing more. One honest dependency: ES256 signing isn't in Python's standard library, so this needs `python3 -m pip install --user pyjwt cryptography` (once per machine).

Save as `verify_asc.py` in a scratch directory (not the repo):

```python
import json, sys, time, urllib.request
from pathlib import Path
import jwt  # pyjwt

cfg = json.loads(Path("~/.appstoreconnect/config.json").expanduser().read_text())
token = jwt.encode(
    {"iss": cfg["issuer_id"], "iat": int(time.time()),
     "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
    Path(cfg["key_path"]).read_text(),
    algorithm="ES256", headers={"kid": cfg["key_id"]},
)
req = urllib.request.Request(
    "https://api.appstoreconnect.apple.com/v1/bundleIds?limit=200",
    headers={"Authorization": f"Bearer {token}"},
)
try:
    data = json.load(urllib.request.urlopen(req))
except urllib.error.HTTPError as e:
    print(f"FAIL: HTTP {e.code} — "
          + ("credential or clock problem (Key ID / Issuer ID / .p8 mismatch, or system time skew)"
             if e.code == 401 else
             "role or access problem (key role too low, or API access not granted — see Step 0)"
             if e.code == 403 else "unexpected"))
    sys.exit(1)
ids = data["data"]
print(f"Authenticated. {len(ids)} bundle ID(s) registered:")
for b in ids:
    print(f"  {b['attributes']['identifier']}  ({b['attributes']['name']})")
```

Run `python3 verify_asc.py` and look at the actual output. A brand-new account listing zero bundle IDs is still a pass — the point is that Apple accepted a token signed with your stored key. Failures mean different things, and the script says which: a **401** is a credential or clock problem; a **403** is a role or access problem. Any non-zero exit is a failure — the script enforces that mechanically, and there is no "probably fine".

For the record, this exact script ran live against production Apple on 2026-08-02 and returned the account's real bundle-ID list (19 registered IDs, exit 0) — the approach is proven, not theoretical.

**The rule this step teaches, which every skill in this repo inherits: evidence, then the claim.** "Setup complete" means "here is Apple's response", never "the steps ran without visible errors."

## What you have now

- A team-wide, revocable machine credential (App Manager role) that later skills authenticate with for routine app operations — no App Store Connect visits, no 2FA.
- A verified, canonical credential location (`~/.appstoreconnect/`) that later skills read instead of re-asking you.
- A clear, honest boundary: app-record creation (~3 minutes on the website, once per app) and account-level admin stay manual, by design.

And ideally, a working model of Apple's auth in your head: official API + short-lived signed JWTs for machines, web session + 2FA for humans, and this OS built entirely on the machine side of that line. When Apple moves the line — say, by adding app creation to the official API — you'll recognize it, and you'll know exactly what to simplify.
