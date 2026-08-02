# ConsumerAppOS

Hi — this is my app factory. It's a repo of agent skills for building small consumer mobile apps, and it's also a course in *why* those apps are built the way they are.

If you're here to build: the skills (coming next) will walk an agent through every stage of producing an app, from brief to App Store. If you're here to learn: every skill explains its own reasoning, so by reading them you pick up the judgment to change them — or to rebuild this whole thing from an empty folder if you had to. That's the bar I write everything here to.

**Author:** meliwat

---

## The Stack & Why

Here's the whole idea, in four steps:

**1. Coding agents are really good at web stuff.** HTML, CSS, and JavaScript is where they do their best UI work — it's the material they handle most fluently. If your workers are agents, you build with the material they're best at.

**2. You watch the app take shape, live.** Claude and Codex can show you a live web preview while they build. You literally see the app's UI coming together in front of you — no phone, no install, no waiting on a native build to find out what a change looks like.

**3. Capacitor is what makes that preview trustworthy.** Capacitor takes the *exact same web app* and puts it on the phone — it wraps your files in a native shell and runs them in a WebView. So the thing you watched come together in the preview is the thing users get. What you see is what you ship.

**4. Compare that to React Native.** An agent building a React Native app could mock the UI as a web page — but that mock is only a reference. The real app gets rebuilt in native components, and it won't match the mock exactly. You previewed a drawing of the app; users get a reinterpretation of it. With our stack there is no gap between the preview and the product.

That's the story. Everything below is just the practical detail of making it work:

| Layer | Choice | Why |
|---|---|---|
| App code | Vanilla HTML + CSS + JavaScript | Renders right in your Claude or Codex preview, or any browser — no downloading to your phone, because the Capacitor wrapper ports exactly this onto the app. What you see is what ships. |
| Native shell | Capacitor 8 | Native distribution, a JS-native bridge, and plugins — haptics, notifications, health, in-app review, payments via RevenueCat — around one web codebase. |
| App backend | None by default | Realistically, most utility-based consumer apps don't need a backend at all. When one is genuinely needed (accounts, shared data, server-side secrets), Supabase is the ideal choice — a Supabase skill is planned. |

This isn't a guess — it's how a real production app of mine already works. And the four-step story above is the test to apply whenever you're tempted to swap something out: does the change keep the preview and the product identical?

### Why vanilla

Vanilla is what makes "the preview IS the app" literally true. Open `index.html` in a browser and you're looking at the actual product — no dev server, no compile step, nothing between what got written and what ships. When something looks wrong, the file you read is the file that ran.

Frameworks and bundlers earn their keep in large codebases — component reuse across big teams, type-checked contracts, optimized dependency graphs. But the price is a build step and a gap between source and shipped artifact, and at the scope of the small, local-first apps this OS targets, that price isn't repaid. A handful of screens scales fine in vanilla. There is no build step to lie to you.

Staying previewable takes a little discipline: code is written as classic `<script>` tags, not bare ESM imports that need a resolver, and APIs that don't work from `file://` are avoided — when one is unavoidable, a trivial static file server (`python3 -m http.server`) covers it. Still zero build.

### What Capacitor actually does

Worth being precise, because it's the fact everything hangs on. Capacitor copies your `www/` folder verbatim into native iOS/Android projects and loads it in a platform WebView, alongside a native runtime, a JS-to-native bridge, and plugins. It does *not* bundle a web application server — anything that needs a server at runtime has nowhere to execute on the device. So the app must be a self-contained static web bundle, and with vanilla files it already is: the folder you previewed is byte-for-byte the folder that ships.

### The plugin convention — how native APIs meet no-build JS

Plugins (haptics, notifications, health, payments…) are what make this a real app rather than a website in a box, and they're the one place the no-build approach needs a deliberate convention.

The wrinkle: Capacitor plugin JS APIs ship as npm ESM packages. A browser can't resolve a bare import like `@capacitor/haptics`, and `cap sync` won't help — it copies your already-prepared web assets into the native projects and wires up native dependencies; it does not convert npm ESM packages into browser-ready bundles. So:

- **Browser-ready plugin bundles get checked into a `vendor/` folder** and loaded as plain `<script>` tags, exactly like the rest of the app.
- **The native side is installed via npm + `cap sync`** as usual.
- **Every supported plugin gets validated against this convention** before a skill may use it.
- **Every plugin gets a browser fallback** — a no-op or mock when the native bridge is absent — so the app still previews in a plain browser without errors.

That's how the reference production app works. One checked-in vendor file per plugin, and native capability never breaks the preview loop.

### App backend: none by default

Realistically, most utility-based consumer apps don't need a backend. Data persists on the device, local notifications fire on-device, and payments and entitlements go through RevenueCat. Managed services still provide remote infrastructure — RevenueCat's servers validate purchases, the app stores handle distribution, and *push* notifications (unlike local ones) require remote delivery infrastructure — but none of that is a backend you operate. Defaulting to "none" means one less service to pay for, secure, operate, and keep available.

**Where data lives on the device:** Capacitor Preferences for small settings and state; SQLite (or an equivalent native store) for substantial structured data; `window.localStorage` only for disposable data, because the OS can evict WebView storage. Know the tradeoff: local-only data isn't guaranteed to survive uninstall or device transfer — if continuity matters for the app, it needs an explicit, tested backup or synchronization strategy, which may use platform backup or an app backend.

When an app genuinely needs accounts, shared data between users, or server-side secrets, Supabase is the ideal choice — it provides auth, a database with row-level authorization, and server-side functions, and a Supabase skill is planned for this repo. When you do add it:

**The trust boundary.** Assume every byte in the app bundle is public — anyone can unzip an app and read it. Publishable identifiers (a Supabase URL, an anon/publishable key) may ship in the client; privileged credentials (service-role keys, third-party API secrets) never do. Authorization is enforced server-side — row-level security and server checks — never by client code, which an attacker controls. Privileged operations execute in trusted systems: native store APIs, vetted provider infrastructure (RevenueCat validates purchases so you don't have to), or hosted functions. Hosted functions are for operations that need private credentials or app-controlled server-side authorization — not for store purchases, which the platform and provider already secure.

### Native checks start early

The browser loop is the default fast loop: open the file, edit, refresh. But the browser can't validate everything — WebView behavior, safe areas, on-screen keyboards, permissions, deep links, and app lifecycle only exist on a device. So simulator/device checks begin with the first vertical slice of an app and recur whenever native integration, storage, auth callbacks, or platform behavior changes. Fast loop by default, native validation at every point where the platforms can diverge — not "native at the very end."

---

## How the OS works

A **skill** is a documented, reusable instruction module: an agent invokes it to perform one stage of app production the same way every time, and a reader studies it to learn why that stage works the way it does.

The pipeline the skills will implement:

**product brief → scaffold → implement → browser validation → native validation → release**

Each stage gets its skill(s) as they land. The one rule that binds them all: **every skill must document its own why.** Nothing enters this repo as bare instructions.

---

## How to use this repo

Two modes, and both are the point:

- **Build with it.** Invoke the skills (as they land). They encode the stack, the patterns, and the guardrails — which removes a major class of device-only failures before code is written.
- **Learn from it.** Read the skills. Each one explains its reasoning, so you come away understanding *why* the pattern exists — which is what you need to change a skill with judgment instead of superstition.

New here? Read this README fully before anything else. The skills will make much more sense once the "static folder in a WebView" model is in your head.
