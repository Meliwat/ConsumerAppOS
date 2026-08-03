---
name: apple-setup
description: One-time Apple foundation setup — request App Store Connect API access if needed, create an API key, store it safely, and verify with a direct authenticated call to Apple's official API. Idempotent — on an already-configured machine it verifies and repairs instead of re-running setup. Run once per Apple developer account; after this, routine app operations (bundle-ID registration, TestFlight uploads, metadata) run without opening App Store Connect. App-record creation and account-level admin stay on the website by design.
---

# apple-setup — agent instructions

Human-readable background and rationale: `README.md` in this directory. This file is procedure.

Scope: official App Store Connect API only. Do not install, invoke, or recommend any tool that authenticates with an Apple ID session or Apple's private web endpoints. App-record creation and account-level admin (agreements, tax, banking, API-access approval) are website tasks — when one is needed, tell the user and wait; do not attempt to automate it.

## Phase A — Detect existing setup (always first)

1. Inventory independently, without reading file contents:
   - `~/.appstoreconnect/config.json`
   - all `.p8` files under `~/.appstoreconnect/private_keys/` (expect possibly several)
2. If nothing exists → Phase B (fresh setup). If anything exists → verify-and-repair: run the FULL audit (Phase C checks 1–4, 8) BEFORE any network call, then Phase D verification. A credential that authenticates but fails the audit is not passing.
3. Multiple `.p8` files: identify the working key — the one `config.json` points at; if no config, the key ID referenced in existing tooling config (env files, CI config). Verify that key (Phase D) before touching anything else. Leftover keys: do NOT delete or revoke; report them to the user as unaudited credential surface with the instruction to revoke stale ones in App Store Connect → Integrations at their own pace.
4. Symlinked credential file: if the target is a pre-existing directory with dependents (other projects reference it), the repair is to point `config.json` at the target's real path and leave dependents intact. Do not relocate the file. Reject (stop and ask the user) only for symlinks whose origin/target you cannot account for.
5. Repair matrix:
   - Audit failure (permissions/location/ignore rules) → fix in place per Phase C. Never move or recreate a key for an audit fix.
   - Auth failure → diagnose per Phase D (401 vs 403) BEFORE any recreation.
   - Recreate only if the key is dead, missing, or has the wrong role (roles are immutable after creation). Order: create replacement → verify it (Phase D) → only then tell the user to revoke the old key. Never leave a gap with no working key. Never overwrite a working key.
   - All checks pass → report pass with the actual output and stop. Do nothing else.

## Phase B — Fresh setup (user-driven steps)

### B0. API access precondition

If App Store Connect shows no Team Keys section: tell the user the Account Holder must go to Users and Access → Integrations → Request Access, agree to the terms, and submit; approval is case-by-case and may take time. Wait for the user to confirm access exists.

If App Store Connect shows an agreements banner (Program License Agreement, paid-apps): tell the user to resolve it now; it will block app creation/submission later. No credential bypasses it.

### B1. Key creation (website, user at keyboard)

Tell the user to:

1. Open App Store Connect → Users and Access → Integrations → App Store Connect API (needs Account Holder or Admin).
2. Team Keys → Generate API Key.
3. Name it recognizably (e.g. `consumerappos-agent`); role: **App Manager**. Warn before they click: the role is immutable — a wrong role means replace-and-revoke later.
4. Download the `.p8` (one-time download; Apple keeps no copy — losing it means revoke-and-recreate).
5. Report back: the Key ID (next to the key) and the Issuer ID (top of page), and the download location of the `.p8`.

Wait for the user to confirm all three before proceeding.

## Phase C — Store credentials (deterministic; every check mandatory, in order)

Target: `.p8` → `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`; IDs → `~/.appstoreconnect/config.json`.

1. `umask 077` for the session.
2. `mkdir -p ~/.appstoreconnect/private_keys && chmod 700 ~/.appstoreconnect ~/.appstoreconnect/private_keys`
3. `test -L` on `~/.appstoreconnect`, `private_keys`, and each credential file. Any symlink → stop; apply Phase A.4 if it qualifies as the blessed case, otherwise ask the user.
4. `git -C ~/.appstoreconnect rev-parse --git-dir` must FAIL (exit non-zero). If it succeeds, the credential dir is inside a worktree → stop and resolve with the user before storing anything.
5. Move the key by pathname only: `mv ~/Downloads/AuthKey_<KEYID>.p8 ~/.appstoreconnect/private_keys/`. Never read the `.p8` contents into a tool call, message, or transcript — key material must transit as a rename, nothing else.
6. Confirm no duplicate `AuthKey_*.p8` remains in `~/Downloads` (and the browser's download dir if different).
7. Write `~/.appstoreconnect/config.json` with a file-writing tool (never `echo`/heredoc — shell history), then `chmod 600` it and the `.p8`:

   ```json
   {
     "key_id": "ABC123XYZ",
     "issuer_id": "12345678-aaaa-bbbb-cccc-1234567890ab",
     "key_path": "/Users/<user>/.appstoreconnect/private_keys/AuthKey_ABC123XYZ.p8"
   }
   ```

   `key_path` must be absolute (no `~` — not every consumer expands it). These three fields only; the file may grow fields later.
8. In every repo the session touches: ensure ignore patterns `*.p8` and `AuthKey_*.p8` exist; run a two-pass secret scan over tracked AND untracked files — (a) filename scan for `*.p8` / `AuthKey_*`, (b) content scan for `BEGIN PRIVATE KEY` and credential-shaped strings. Report matching FILENAMES ONLY — never print matched contents (the scan must not become the leak). Known benign match: `skills/apple-setup/SKILL.md` names these patterns; a markdown file that merely names a pattern is documentation. Investigate any other hit.

## Phase D — Verify (evidence, then the claim)

Precondition: `python3 -c "import jwt, cryptography"` — if it fails, `python3 -m pip install --user pyjwt cryptography` (ES256 is not in the stdlib).

Write `verify_asc.py` in a scratch directory (NOT the repo):

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
             "role or access problem (key role too low, or API access not granted — see Phase B0)"
             if e.code == 403 else "unexpected"))
    sys.exit(1)
ids = data["data"]
print(f"Authenticated. {len(ids)} bundle ID(s) registered:")
for b in ids:
    print(f"  {b['attributes']['identifier']}  ({b['attributes']['name']})")
```

Run `python3 verify_asc.py` and show the user the real output.

- Zero bundle IDs on a new account = PASS (Apple accepted the token; that is the test).
- 401 = credential/clock; 403 = role/access (send the user to Phase B0). Any non-zero exit = FAIL. No "probably fine".
- Report "setup complete" only alongside Apple's actual response. Never report success from steps-ran-without-errors.
