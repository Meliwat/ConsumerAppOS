# apple-setup — why it works this way

This is the foundation skill of the whole OS. You run it once per Apple developer account, and it's the only setup Apple ever requires of you. After it, the routine operations — registering bundle IDs, uploading builds, managing TestFlight and metadata — run through Apple's official API without you ever opening App Store Connect. (The `SKILL.md` next to this file is the agent's procedure; this is the part written for you.)

## The two ways into Apple

Apple gives you two ways to prove who you are to their developer machinery, and understanding the split is most of understanding this skill:

1. **Your Apple ID** — email, password, 2FA prompt on your device. This is how a *human* logs in, and it's deliberately hostile to automation: the 2FA prompt exists precisely so a script can't be you.
2. **An App Store Connect API key** — a `.p8` private key file. Tools use it to sign short-lived tokens (at most 20 minutes each; the key itself lives until you revoke it), and Apple's official API accepts those tokens as proof. No password, no 2FA, no session. This is how a *machine* logs in, and Apple built it specifically so automated tools can work unattended.

The API key wins for everything we automate, and not just for convenience: it has a **role** you pick at creation, it's **revocable** with one click without touching your Apple ID, and it never expires on its own. Once this model is in your head, you could rebuild the skill from scratch — everything in it is just careful handling of one private key.

## Alternative: set it up yourself

Totally fair if you'd rather not point an agent at your Apple credentials. You can do this by hand in about five minutes, and as long as things end up in the right places, every other skill in this OS will work exactly the same:

1. In [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access** → **Integrations** → **App Store Connect API**, generate a Team Key with the **App Manager** role. Download the `.p8` (you only get one shot — Apple keeps no copy) and note the **Key ID** and **Issuer ID** shown on that page.
2. Put the key at `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`.
3. Next to it, create `~/.appstoreconnect/config.json`:

   ```json
   {
     "key_id": "YOUR_KEY_ID",
     "issuer_id": "YOUR_ISSUER_ID",
     "key_path": "/Users/you/.appstoreconnect/private_keys/AuthKey_YOUR_KEY_ID.p8"
   }
   ```

   Use the real absolute path, not `~`. This file is the link between you and the rest of the OS — every later skill reads it to find your credentials instead of asking you, so the paths and field names need to match exactly.
4. Lock it down: `chmod 700 ~/.appstoreconnect ~/.appstoreconnect/private_keys` and `chmod 600` on both files. And keep all of it out of your repos — this key can manage every app on your account.

At the end of the day, if something's not working, your agent will fix it.
