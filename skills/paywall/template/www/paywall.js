/* paywall.js — activates the onboarding template's paywall placeholder.
   Loaded LAST (after app.js and shell.js). ACTIVATION, not replacement:
   the screen's markup and app.js stay untouched; clicks are intercepted in
   the CAPTURE phase so app.js's own navigation runs only when entitlement
   (or an explicit skip) allows it.

   GATE MODEL — soft paywall, stated plainly: the ✕ close is a real skip
   that reaches the shell without paying, exactly as the onboarding
   template designed. What entitlement controls is ROUTING (entitled
   launches land in the shell, un-entitled launches land back on the
   paywall) and the persisted `paywall.entitled` flag that later skills
   read to gate features. Nothing else is protected by this skill.

   FAIL-SAFE: if the purchases adapter is missing or broken, the CTA and
   Restore never fall through to fake success — they surface an explicit
   unavailable state and the user can retry. A native context can NEVER
   take the mock path (the adapter enforces the world model; this file
   enforces "no adapter = no grants").

   RECONCILE MODEL (implemented exactly as documented): on launch in store
   mode the configured entitlement is re-checked FRESHLY with RevenueCat
   (the SDK's CustomerInfo cache is invalidated first) — VERIFIED
   active grants, VERIFIED inactive revokes (flag cleared, un-touched
   sessions are routed back to the paywall), errors/unknown RETAIN
   last-known access. Revocation therefore happens only on proof. */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var paywall = $('.screen[data-screen="paywall"]');
  if (!paywall) return;

  var ENTITLED_KEY = "paywall.entitled";
  var ONBOARDED_KEY = "paywall.onboarded";
  var MOCKBUY_KEY = "paywall.mockPurchased"; // mock purchase HISTORY — restore's source of truth in the mock world

  /* Same storage convention as app.js (private there, so mirrored here):
     Preferences bridge when native, localStorage fallback, never throws. */
  var store = {
    set: function (k, v) {
      try {
        var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
        if (P) return Promise.resolve(P.set({ key: k, value: v })).catch(function () {});
        localStorage.setItem(k, v);
      } catch (e) {}
      return Promise.resolve();
    },
    get: function (k) {
      try {
        var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
        if (P) return Promise.resolve(P.get({ key: k })).then(function (r) { return r && r.value; }).catch(function () { return null; });
        return Promise.resolve(localStorage.getItem(k));
      } catch (e) { return Promise.resolve(null); }
    }
  };

  var haptic = {
    light: function () { if (window.AppHaptics) window.AppHaptics.light(); },
    success: function () { if (window.AppHaptics) window.AppHaptics.success(); }
  };

  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  var entitled = false;
  var busy = false;
  var plansData = null; // last successful offerings result

  /* ---- launch routing (instant initial state, cancelled by any user
     interaction) ---- */
  var SEQUENCE = ["welcome", "q1", "q2", "q3", "q4", "q5", "q6", "q7",
                  "affirm", "building", "proof", "notify", "paywall", "home"];
  /* "Un-touched" counts ANY user activity — pointer or keyboard. (Focus
     changes alone are excluded on purpose: routeTo itself moves focus
     programmatically, which must not count as the user acting.) */
  var userTouched = false;
  function markTouched() { userTouched = true; }
  document.addEventListener("pointerdown", markTouched, { capture: true, once: true });
  document.addEventListener("keydown", markTouched, { capture: true, once: true });

  function routeTo(name) {
    if (userTouched) return;
    var cur = $(".screen.active");
    var nxt = $('.screen[data-screen="' + name + '"]');
    if (!nxt || cur === nxt) return;
    if (cur) cur.classList.remove("active");
    nxt.classList.add("active");
    var step = SEQUENCE.indexOf(name) + 1;
    var fill = $(".progress-fill"), track = $(".progress-track");
    if (fill) fill.style.width = (step / SEQUENCE.length * 100) + "%";
    if (track) track.setAttribute("aria-valuenow", String(step));
    var h = nxt.querySelector("h1, h2");
    if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
  }

  function grant() {
    entitled = true;
    store.set(ENTITLED_KEY, "1");
  }
  function revoke() {
    entitled = false;
    store.set(ENTITLED_KEY, "0");
  }

  /* Store-mode reconcile: grant on VERIFIED active, revoke on VERIFIED
     inactive (the "0" is persisted immediately, before any routing),
     retain last-known on unknown/error. `storeVerdict` records the last
     VERIFIED store answer — it is the authority a late local read must
     never override. */
  /* Adapter calls go through this trampoline: presence-validated and
     invoked inside a resolved promise, so even a SYNCHRONOUS throw from a
     broken adapter lands in the caller's catch — the UI always recovers. */
  function callAdapter(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    return Promise.resolve().then(function () {
      var A = window.AppPurchases;
      if (!A || typeof A[method] !== "function") throw new Error("purchases adapter missing " + method);
      return A[method].apply(A, args);
    });
  }
  function adapterMode() {
    try {
      var A = window.AppPurchases;
      return (A && typeof A.mode === "function") ? A.mode() : "unavailable";
    } catch (e) { return "unavailable"; }
  }

  var storeVerdict = null; // null | "active" | "inactive" (verified only)
  function reconcile() {
    if (adapterMode() !== "store") return;
    callAdapter("checkEntitlement").then(function (res) {
      if (res.status === "active") {
        storeVerdict = "active";
        if (!entitled) { grant(); routeTo("home"); }
      } else if (res.status === "inactive") {
        storeVerdict = "inactive";
        var hadAccess = entitled;
        revoke(); // "0" is persisted UNCONDITIONALLY on a verified-inactive
        if (hadAccess) routeTo("paywall"); // only the routing depends on prior access
      }
      /* "unknown" → keep last-known access; never treat an error as a denial */
    }).catch(function () { /* typed results normally; retain on anything else */ });
  }

  /* Persisted-state reads: a slow Preferences bridge must not hang the app
     (route on a timeout default), but LATE responses are still applied —
     never discarded. Authority rule: a late local "1" may grant/route
     directly only where no store authority exists (mock/unavailable
     worlds). In store mode it triggers reconciliation instead — the
     verified store answer decides. A stale local "1" can never route home
     after the store said inactive. */
  var launchRouted = false;
  function applyPersisted(entVal, onbVal) {
    if (!launchRouted) {
      launchRouted = true;
      if (entVal === "1") entitled = true;
      if (entitled) routeTo("home");
      else if (onbVal === "1") routeTo("paywall");
      reconcile();
      return;
    }
    /* late arrival after the timeout default already routed */
    if (entVal === "1" && !entitled) {
      /* A VERIFIED-INACTIVE verdict is checked FIRST and stands regardless
         of what mode() answers now: stamp out the stale "1", re-verify,
         and never grant or route on the late flag itself. */
      if (storeVerdict === "inactive") {
        store.set(ENTITLED_KEY, "0");
        reconcile();
      } else if (storeVerdict === "active") {
        grant(); routeTo("home");
      } else if (adapterMode() === "store") {
        reconcile(); // no verdict yet → the verified answer decides
      } else {
        entitled = true; // local-authority worlds: the local flag governs
        routeTo("home");
      }
    } else if (!entitled && onbVal === "1") routeTo("paywall");
  }
  Promise.all([store.get(ENTITLED_KEY), store.get(ONBOARDED_KEY)])
    .then(function (v) { applyPersisted(v[0], v[1]); })
    .catch(function () { /* reads never reject by construction */ });
  setTimeout(function () {
    if (!launchRouted) { launchRouted = true; reconcile(); }
  }, 800);

  /* ---- CTA language: derived from VERIFIED state, per selection.
     Trial wording appears ONLY for a selected plan with a verified
     eligible free trial; everything else says Subscribe. ---- */
  function selectedPlan() {
    var sel = $(".btn.price.selected", paywall);
    return (sel && sel.dataset.price) || "yearly";
  }
  function updateCtaLabel() {
    var cta = $('[data-action="paywall-cta"]', paywall);
    if (!cta || busy) return;
    var entry = plansData && plansData.plans[selectedPlan()];
    cta.textContent = (entry && entry.valid && entry.trialEligible && entry.trialDuration)
      ? "Start My Free Trial" : "Subscribe";
  }
  /* runs AFTER app.js's own bubble handler flips .selected (script order) */
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".btn.price")) updateCtaLabel();
  });

  /* ---- offerings → existing markup (no structural changes) ----
     The example-offer label persists until EVERY displayed plan has a
     validated product id, nonempty localized price, period, and
     eligibility-derived language. Invalid plans are HIDDEN, not shown
     unlabeled. */
  var offeringsLoaded = false;
  function loadOfferings() {
    if (offeringsLoaded || !window.AppPurchases) return;
    offeringsLoaded = true;
    callAdapter("getOfferings").then(function (res) {
      plansData = res;
      var banner = $(".mock-banner", paywall);
      var anyVisible = false, allVisibleValid = true;
      ["yearly", "monthly"].forEach(function (plan) {
        var btn = $('.btn.price[data-price="' + plan + '"]', paywall);
        if (!btn) return;
        var entry = res.plans[plan];
        if (!entry || !entry.valid) {
          btn.hidden = true; // partial data: hide rather than show unvalidated
          if (btn.classList.contains("selected")) {
            /* move selection to a surviving plan */
            var other = $('.btn.price:not([hidden])', paywall);
            if (other) {
              btn.classList.remove("selected"); btn.setAttribute("aria-checked", "false"); btn.tabIndex = -1;
              other.classList.add("selected"); other.setAttribute("aria-checked", "true"); other.tabIndex = 0;
            }
          }
          return;
        }
        anyVisible = true;
        btn.hidden = false;
        var amt = $(".price-amt", btn);
        if (amt) amt.textContent = entry.priceString + " / " + entry.periodLabel;
        var badge = $(".price-badge", btn);
        if (badge) {
          if (entry.trialEligible && entry.trialDuration) badge.textContent = entry.trialDuration + " free";
          else badge.remove(); // no VERIFIED trial → no trial claim
        }
      });
      if (res.source === "store" && anyVisible && allVisibleValid) {
        if (banner) banner.remove(); // every visible plan fully validated
      } else if (banner) {
        banner.textContent = "Mock prices — real ones load once App Store products connect";
      }
      updateCtaLabel();
    }).catch(function (e) {
      offeringsLoaded = false; // placeholders + banner stay; retried on next arrival
      updateCtaLabel();        // still no unverified trial language
      try { console.warn("[paywall] offerings unavailable:", e); } catch (x) {}
    });
  }

  var wasActive = false;
  function onPaywallState() {
    var a = paywall.classList.contains("active");
    if (a && !wasActive) {
      store.set(ONBOARDED_KEY, "1");
      updateCtaLabel(); // neutral language immediately; data may refine it
      loadOfferings();
    }
    wasActive = a;
  }
  new MutationObserver(onPaywallState)
    .observe(paywall, { attributes: true, attributeFilter: ["class"] });
  onPaywallState();

  function setCtaBusy(cta, on) {
    if (on) { cta.dataset.label = cta.textContent; cta.textContent = "Processing…"; cta.disabled = true; }
    else { if (cta.dataset.label) cta.textContent = cta.dataset.label; cta.disabled = false; busy = false; updateCtaLabel(); }
  }

  var MSG = {
    unavailable: "Purchases aren't available right now — please try again shortly.",
    unconfirmed: "We couldn't confirm your purchase. If you were charged, tap Restore Purchases.",
    restoreError: "We couldn't check your purchases — try again in a moment.",
    restoreNone: "No purchases to restore.",
    restored: "Purchases restored."
  };

  /* ---- capture-phase gate: nothing reaches app.js's CTA action without
     entitlement; a missing/broken adapter blocks with an explicit
     unavailable state (never a silent pass, never a fake grant). ---- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button");
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === "paywall-cta") {
      if (entitled) return; // gate open — app.js navigates as templated
      e.stopPropagation();
      e.preventDefault();
      if (busy) return;
      if (!window.AppPurchases) { toast(MSG.unavailable); return; }
      busy = true;
      setCtaBusy(btn, true);
      callAdapter("purchase", selectedPlan()).then(function (res) {
        setCtaBusy(btn, false);
        if (res.outcome === "purchased") {
          grant();
          if (res.source === "mock") store.set(MOCKBUY_KEY, "1");
          haptic.success();
          btn.click(); // gate is open now — app.js runs its own paywall-cta
        } else if (res.outcome === "cancelled") {
          /* the user's explicit choice — no message */
        } else if (res.outcome === "unavailable") {
          toast(MSG.unavailable);
        } else {
          /* unconfirmed / error: StoreKit may have charged — stay neutral */
          toast(MSG.unconfirmed);
        }
      }).catch(function () {
        /* adapter results are typed; this is the UI's own last resort so
           the CTA can never be stuck on "Processing…" */
        setCtaBusy(btn, false);
        toast(MSG.unconfirmed);
      });
      return;
    }

    if (action === "paywall-restore") {
      e.stopPropagation(); // replaces the template's inert mock toast
      e.preventDefault();
      if (busy) return;
      haptic.light();
      if (!window.AppPurchases) { toast(MSG.unavailable); return; }
      busy = true;
      store.get(MOCKBUY_KEY).then(function (v) {
        return callAdapter("restore", v === "1");
      }).then(function (res) {
        busy = false;
        if (res.status === "restored") {
          grant();
          toast(MSG.restored);
          var cta = $('[data-action="paywall-cta"]', paywall);
          if (cta) cta.click(); // gate open → app.js navigates home
        } else if (res.status === "none") {
          toast(MSG.restoreNone);   // VERIFIED empty
        } else {
          toast(MSG.restoreError);  // failure — distinct from verified-empty
        }
      }).catch(function () {
        busy = false; // UI last resort: restore must never wedge the gate
        toast(MSG.restoreError);
      });
      return;
    }
    /* paywall-close (✕) deliberately passes through: the soft-gate skip,
       exactly as documented above. */
  }, true);
})();
