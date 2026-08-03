# onboarding — why it works this way

This is the scaffold skill. Give it an app name and one line about what the app does, and you get back a complete, previewable app — not a blank project, but a working shell with a full consumer onboarding flow already in place: welcome screen, personalization quiz, a "building your plan" moment, social proof, notification prime, paywall, home screen. Open `www/index.html` and tap through the whole thing. Every app this OS produces starts here.

## Fixed skeleton, curated content

The core design decision: the screen sequence never changes. Welcome → quiz → plan-building → social proof → notification prime → paywall → home, every time, for every app — down to fixed question counts, CTA labels, and DOM shape. And the skeleton isn't a description the agent interprets: it lives as actual template files in this skill's `template/` folder, copied verbatim, with the app-specific content filled into marked slots. What your one-line description controls is the *content* poured into that skeleton: the promise on the welcome screen, the quiz questions, what the "plan" is called, the paywall's feature list.

This is an opinionated, reusable pattern, modeled closely on the reference app in this repo and on the onboarding shape common in subscription consumer apps (Cal AI is the archetype). Each stage carries a behavioral hypothesis worth knowing, because it tells you what the stage is *for*:

- **Welcome** — a single clear promise before asking anything of the user.
- **Quiz** — single-tap questions that feel like personalization; each answer is a small commitment that builds momentum.
- **Building your plan** — visibly converting the answers into something made *for them*; the pause itself signals work being done on their behalf.
- **Social proof** — reassurance at the moment doubt would naturally surface.
- **Notification prime** — a soft ask before any system dialog, so the real prompt (wired later) arrives pre-justified and a "no" here costs nothing permanent.
- **Paywall** — the offer placed after the user has invested, not before.

Fixing the skeleton buys three things: every app gets the same deliberate flow instead of an improvised one, any improvement to the template reaches every future app, and the floor stays consistent no matter how thin the input was. Whether the hypotheses hold for *your* app is something you measure — the skeleton just makes sure you start from a coherent version of the pattern rather than reinventing it.

Two screens are deliberately hollow: the notification prime has no real permission wiring, and the paywall is pure structure with no payment logic. Those get wired by later skills. And one rule survives everything: the social proof and pricing screens render clearly-labeled example content — mock reviews, placeholder prices — until real, verifiable data replaces them. The scaffold will not manufacture fake credibility.

## The native-feel layer

A WebView app without deliberate work feels like a website in a box — text accidentally selects when you tap, the page rubber-bands, a double-tap zooms the interface, inputs zoom the viewport on focus, content hides behind the notch. Users can't name any of these, but they feel all of them, instantly.

So the generated shell bakes in the full checklist: zoom suppression (viewport meta plus Capacitor's `zoomEnabled: false`), the body locked into an app frame with scrolling only in inner regions, text selection off everywhere except inputs, real safe-area handling for notch and home indicator, the system font stack, 44px touch targets with press states instead of hover, and accessibility as fixed behavior — real buttons, focus moving to each new screen, reduced-motion honored. None of it is visible in a screenshot; all of it is the difference between "app" and "webpage."

One nice trick from the reference implementation: native-only behaviors are gated on detecting the Capacitor shell, so in a desktop browser you get a phone-shaped preview frame with a fake status bar — pleasant to develop in — while on a real device the same files go full-bleed and defer to actual safe areas.

## Give it more, get more

The input scales, and the floor is deliberate. Name and one line: the full flow with sensible copy and a polished default theme. Add an App Store link or a screenshot of a look you like: the theming layer picks up palette and tone from it. And because all styling flows through a small set of design tokens — colors, type scale, spacing, radius — theming can only ever change how the app *looks*, never how the flow *works*. The skeleton is protected from your inspiration on purpose.
