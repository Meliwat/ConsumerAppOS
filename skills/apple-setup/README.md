# apple-setup — why it works this way

This is the foundation skill of the whole OS. You run it once per Apple developer account, and it's the only setup Apple ever requires of you. After it, the routine operations — registering bundle IDs, uploading builds, managing TestFlight and metadata — run through Apple's official API without you ever opening App Store Connect. (The `SKILL.md` next to this file is the agent's procedure; this is the part written for you.)

## The two ways into Apple

Apple gives you two ways to prove who you are to their developer machinery, and understanding the split is most of understanding this skill:

1. **Your Apple ID** — email, password, 2FA prompt on your device. This is how a *human* logs in, and it's deliberately hostile to automation: the 2FA prompt exists precisely so a script can't be you.
2. **An App Store Connect API key** — a `.p8` private key file. Tools use it to sign short-lived tokens (at most 20 minutes each; the key itself lives until you revoke it), and Apple's official API accepts those tokens as proof. No password, no 2FA, no session. This is how a *machine* logs in, and Apple built it specifically so automated tools can work unattended.

The API key wins for everything we automate, and not just for convenience: it has a **role** you pick at creation, it's **revocable** with one click without touching your Apple ID, and it never expires on its own. Once this model is in your head, you could rebuild the skill from scratch — everything in it is just careful handling of one private key.

## Why official-API-only (the fastlane story)

An earlier version of this skill used fastlane to cover the one thing Apple's official API doesn't offer: creating a new app record. fastlane does it by riding Apple's *private* web endpoints with an Apple ID session — clever, widely used, and fundamentally at Apple's mercy.

On this skill's **first live run** (August 2, 2026), that half broke in the most instructive way possible: password accepted, 2FA code accepted, then `Unauthorized Access` — because Apple had changed their login flow to a new protocol, and no released version of fastlane could complete a login. Not our credentials, not our setup; the ecosystem itself, mid-breakage. The fix existed only as open pull requests.

That settled the design question. The skill is now built entirely on the API Apple publicly commits to, and the gap is handled honestly instead of cleverly: **creating an app record is a ~3-minute website visit, once per app's lifetime.** Account-level admin (agreements, tax, banking, the API-access approval itself) also stays on the website — Apple deliberately keeps those human. Everything else is automated. We don't build on things that break on someone else's schedule.

## The threat model, honestly

The role we use is **App Manager** — the least-privileged role that still covers full app management: bundle IDs, metadata, builds, TestFlight, and some user-and-access management. But know what you're holding: a team key is **team-wide**. It applies to your entire app portfolio and cannot be scoped to one app. The real difference from Admin is ceilings, not scope — Admin adds account-level powers automation never needs.

So the `.p8` gets treated like what it is: the secret half of a credential that, with its Key ID and Issuer ID, can manage every app on your account. It's downloadable exactly once (Apple keeps no copy), unrecoverable by design, and that's why the skill is so ceremonial about it — permissions locked down, moved by rename so its contents never enter a transcript, never near a repo, and scanned for afterwards. If it ever leaks, revoke it in Integrations immediately; that one click is the whole recovery plan, and it works.

## Shaped by real machines, not theory

The skill's odd-looking provisions all come from its first live run on an actual shipping developer's Mac:

- **It expects multiple leftover keys**, because it found four — three of unknown validity. Old keys accumulate on any machine that's shipped apps. The skill identifies and verifies the working one and tells you about the rest; revoking stale keys is your call, at your pace.
- **It blesses one symlink repair**, because the working key's real home turned out to be a pre-existing directory that other projects depended on. Pointing the config at the real path and leaving everything intact beat "relocate everything to the canonical spot" — repair shouldn't break things that work.
- **Its verification is real**, not ceremonial: a small script that builds the signed token itself and asks Apple's production API to list the account's bundle IDs. On that first run it came back with all 19 — which is the standard every skill here inherits: evidence first, then the claim. "Setup complete" means "here is Apple's response," never "the steps ran without visible errors."

The verification script is also the best teaching artifact in the skill: read it and you see exactly what machine auth to Apple *is* — a JSON payload, an ES256 signature from the `.p8`, a bearer header, one GET. No toolchain in between. When Apple changes something — say, one day adding app creation to the official API — you'll recognize what it means and know exactly which part of this skill to simplify.
