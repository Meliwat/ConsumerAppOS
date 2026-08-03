# apple-setup — why it works this way

This is the foundation skill of the whole OS. You run it once per Apple developer account, and it's the only setup Apple ever requires of you. After it, the routine operations — registering bundle IDs, uploading builds, managing TestFlight and metadata — run through Apple's official API without you ever opening App Store Connect. (The `SKILL.md` next to this file is the agent's procedure; this is the part written for you.)

## The two ways into Apple

Apple gives you two ways to prove who you are to their developer machinery, and understanding the split is most of understanding this skill:

1. **Your Apple ID** — email, password, 2FA prompt on your device. This is how a *human* logs in, and it's deliberately hostile to automation: the 2FA prompt exists precisely so a script can't be you.
2. **An App Store Connect API key** — a `.p8` private key file. Tools use it to sign short-lived tokens (at most 20 minutes each; the key itself lives until you revoke it), and Apple's official API accepts those tokens as proof. No password, no 2FA, no session. This is how a *machine* logs in, and Apple built it specifically so automated tools can work unattended.

The API key wins for everything we automate, and not just for convenience: it has a **role** you pick at creation, it's **revocable** with one click without touching your Apple ID, and it never expires on its own. Once this model is in your head, you could rebuild the skill from scratch — everything in it is just careful handling of one private key.
