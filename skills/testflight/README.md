# testflight — why it works this way

This is the "feel it on your phone" skill. After any implementation step, one invocation takes the current `www/` bundle, wraps it in the native project, signs it, uploads it, and gets it onto your phone through TestFlight. That's the steady state — it holds after the one-time prerequisites are done: the app-record website visit, the first signing run (which may ask you to approve a Keychain prompt and, once, to confirm your team), and adding yourself to the private owner group as an internal tester. And "lands on your phone" depends on two real conditions the skill checks rather than assumes: your membership in that group, and export compliance being answerable (it sets the no-encryption flag only when truthfully applicable — apps with their own crypto stop for real compliance answers). After that: you keep coding, fresh builds keep appearing. It's the skill that closes the loop the root README promises: browser preview for iteration speed, real device for truth.

## What happens on first run vs. every run

The first run per app does the one-time plumbing: creates the native iOS project (`npx cap add ios`), locks the app to portrait, wires the splash screen (the half the onboarding skill deliberately deferred — config without the native plugin does nothing), registers the bundle ID, and smoke-builds for the simulator before any signing work, because a project that can't build has no business near an upload.

It also hits the one step that stays human: creating the app record in App Store Connect. Apple's official API can do almost everything — register bundle IDs, list builds, manage TestFlight groups — but not "make the app exist." The skill tells you exactly what to type into the New App form — name, language, bundle ID, SKU — and waits. Three minutes, once per app, ever.

Every subsequent run is just: copy web bundle → bump build number → archive → export → upload → confirm. You keep coding; fresh builds keep appearing on your phone.

## Why the pieces are what they are

**Signing is automatic, authenticated by the API key.** `xcodebuild -allowProvisioningUpdates` plus the apple-setup credentials lets Xcode create and refresh certificates and provisioning profiles unattended. Nobody manages profiles by hand here — that's a category of misery Apple already automated away, if you hand the tools a machine credential.

**Upload uses `altool` with the API key.** Verified on the Xcode this repo actually runs (26.4): `xcrun altool --upload-app` ships, takes `--apiKey`/`--apiIssuer`, and searches `~/.appstoreconnect/private_keys/` for the key — the exact location apple-setup established. One credential, stored once, drives signing, upload, and every API call. The skill also names its fallbacks in order, because Apple retires upload tools on their own schedule and the skill should outlive any one of them.

**Internal group, not external.** Internal TestFlight testers (you, as a team member) get builds the moment processing finishes — no beta review, no waiting. External groups exist for real beta testers later; for the build-feel-fix loop, internal is the only sane default. One practical note from the root README applies here: keep yourself in a private internal group so your iteration builds don't spam anyone else.

**"Shipped" is an API response, not an exit code.** The upload tool exiting cleanly means Apple *received* bytes; it doesn't mean a build exists. The skill's definition of done is the App Store Connect API showing your build in processing — evidence you can see, in keeping with the repo's rule that claims come after proof.

**Three lanes, honestly ranked.** The skill's real workhorse for daily iteration is the **wireless direct install**: after a one-time cable pairing with "Connect via network" enabled, `devicectl` builds, installs, and launches a development build on your phone over Wi-Fi in seconds — no upload, no processing wait. **TestFlight** is for the moments that need more than your own phone: sharing with testers, installing without a Mac nearby, or a build you want to keep around. And the **cable** stays documented as the fallback that always works when wireless or Apple's services are having a day. The point of this skill isn't ceremony — it's the shortest honest route from code to thumb, three ways.
