/* onboarding flow — fixed skeleton logic. Structure is canonical; do not
   add/remove/reorder screens. Content lives in index.html slots.
   ONE transition mechanism for the whole app: every screen change — including
   quiz question → question — goes through show(). Zero special cases. */
(function () {
  "use strict";

  /* Build stamp: bump on every device push so stale-delivery is visible
     on-screen. Rendered bottom corner of the welcome screen. */
  var BUILD_STAMP = "b1";

  var SEQUENCE = ["welcome", "q1", "q2", "q3", "q4", "q5", "q6", "q7",
                  "affirm", "building", "proof", "notify", "paywall", "home"];
  var QUIZ_TOTAL = 7;
  var STORE_KEY = "onboarding.answers";
  var TRANSITION_MS = 260; // full-push duration; cleanup timeout keys off this

  /* Read Reduce Motion FRESH at each transition — a load-time snapshot can
     race WKWebView's reporting of the OS setting and mis-route the lifecycle. */
  var rmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  function reduceMotionNow() { return rmQuery.matches; }

  /* Storage adapter — repo plugin convention: native implementation with a
     browser fallback. Onboarding answers are DURABLE app state. The native
     path requires @capacitor/preferences (installed by the native-packaging
     skill); until then the localStorage fallback carries preview state.
     Every read/write is wrapped: a storage failure must never break
     navigation. */
  var store = {
    set: function (k, v) {
      try {
        var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
        if (P) return P.set({ key: k, value: JSON.stringify(v) }).catch(function () {});
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) { /* storage unavailable: continue in-memory */ }
      return Promise.resolve();
    },
    get: function (k) {
      try {
        var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
        if (P) {
          return P.get({ key: k })
            .then(function (r) { return r && r.value ? JSON.parse(r.value) : null; })
            .catch(function () { return null; });
        }
        var v = localStorage.getItem(k);
        return Promise.resolve(v ? JSON.parse(v) : null);
      } catch (e) { return Promise.resolve(null); }
    }
  };

  var state = { answers: {} };
  /* Selection UI rule: a question shows NO selection and a disabled Continue
     on FIRST arrival, even when a persisted answer exists — pre-selection is
     shown only when navigating back to a question answered THIS session. */
  var sessionAnswered = {};
  var hydrated = false;      // interaction gated until hydration (or timeout)
  var transitioning = false; // blocks re-entrant screen changes (all screens, quiz included)

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* Haptics via the vendored wrapper (www/vendor/haptics.js) — guarded so a
     missing vendor file can never break the flow. */
  var haptic = {
    light: function () { if (window.AppHaptics) window.AppHaptics.light(); },
    success: function () { if (window.AppHaptics) window.AppHaptics.success(); }
  };

  var progressTrack = $(".progress-track");
  var progressFill = $(".progress-fill");
  var stage = $("#screen");

  /* Focusing an element inside a screen that is still translated offscreen
     makes WebKit scroll the overflow-hidden stage to reveal it — the scroll
     offset combines with the animating transforms and the push geometry
     breaks. Always focus with preventScroll and pin the stage at 0. */
  function focusHeading(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    stage.scrollLeft = 0; stage.scrollTop = 0;
  }

  /* ---- entrance choreography: generic, DOM-order-driven stagger.
     prep before the push (content hidden while the panel slides), run at
     push completion. Budget: n*40ms stagger + 240ms rise <= ~450ms. Never
     under reduced motion — everything appears instantly at end state. ---- */
  var STAGGER_MS = 30, RISE_MS = 200;

  function prepChoreo(container) {
    if (reduceMotionNow()) return null;
    var els = $$(".screen-body > *, .cta-bar > *", container);
    if (!els.length) return null;
    els.forEach(function (el, i) { el.style.transitionDelay = (i * STAGGER_MS) + "ms"; });
    container.classList.add("choreo", "choreo-pre");
    return els;
  }

  function runChoreo(container, els) {
    if (!els) return;
    void container.offsetWidth; // commit the hidden start state
    container.classList.remove("choreo-pre");
    setTimeout(function () {
      container.classList.remove("choreo");
      els.forEach(function (el) { el.style.transitionDelay = ""; });
    }, els.length * STAGGER_MS + RISE_MS + 60);
  }

  /* Whole-flow progress: 14 equal units, one per screen in SEQUENCE.
     Visibly filled from step 1, full at the final screen; aria in sync. */
  var TOTAL_STEPS = SEQUENCE.length;
  function setProgress(step) {
    progressFill.style.width = (step / TOTAL_STEPS * 100) + "%";
    progressTrack.setAttribute("aria-valuenow", String(step));
  }

  function quizIndex(name) {
    var m = /^q([1-7])$/.exec(name);
    return m ? Number(m[1]) : 0;
  }

  /* Restored state must be shaped exactly like we saved it: keys q1..q7,
     values "1".."4". Anything else is dropped, never trusted. */
  function sanitizeAnswers(raw) {
    var clean = {};
    if (raw && typeof raw === "object") {
      for (var i = 1; i <= QUIZ_TOTAL; i++) {
        var v = raw["q" + i];
        if (v === "1" || v === "2" || v === "3" || v === "4") clean["q" + i] = v;
      }
    }
    return clean;
  }

  /* ---- THE screen lifecycle: enter/leave classes; display:none can't animate.
     A new transition synchronously completes the previous one's cleanup first
     (fast taps never overlap two lifecycles); transitionend is the primary
     cleanup signal; the timeout fallback is generous. Reduced motion is a
     clean instant cut (CSS additionally hides .leaving under RM). ---- */
  var pendingScreenCleanup = null;

  function show(name, back) {
    var cur = $(".screen.active");
    var nxt = $('.screen[data-screen="' + name + '"]');
    if (!nxt || cur === nxt) return;
    if (pendingScreenCleanup) pendingScreenCleanup(); // cancel/complete previous NOW
    if (reduceMotionNow() || !cur) {
      if (cur) cur.classList.remove("active");
      nxt.classList.add("active");
      afterShow(name, nxt);
      return;
    }
    transitioning = true;
    var choreoEls = prepChoreo(nxt); // content hidden while the panel slides in
    cur.classList.add("leaving");
    if (back) { cur.classList.add("to-right"); nxt.classList.add("from-left"); }
    cur.classList.remove("active");
    nxt.classList.add("enter", "active");
    // Force a synchronous style/layout flush so the enter state is COMMITTED
    // before it changes — double-rAF alone can coalesce into one flush in
    // WebKit, cancelling the transition (push degrades to a crossfade).
    void nxt.offsetWidth;
    requestAnimationFrame(function () { nxt.classList.remove("enter"); });
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      pendingScreenCleanup = null;
      cur.removeEventListener("transitionend", onEnd);
      cur.classList.remove("leaving", "to-right");
      nxt.classList.remove("from-left");
      transitioning = false;
    }
    // transitionend bubbles from descendants: only the outgoing screen's own
    // opacity transition counts. Filter without {once:true} so a bubbled
    // event can't consume the listener; the timeout is the guaranteed path.
    function onEnd(ev) {
      if (ev.target === cur && ev.propertyName === "opacity") finish();
    }
    pendingScreenCleanup = finish;
    cur.addEventListener("transitionend", onEnd);
    setTimeout(finish, TRANSITION_MS + 250); // generous: fallback only, never the scissors
    // choreography overlaps the push tail: stagger starts as the screen is
    // ~60% arrived, so the heading is visible essentially as it lands —
    // no frame of empty screen.
    setTimeout(function () { runChoreo(nxt, choreoEls); }, Math.round(TRANSITION_MS * 0.6));
    afterShow(name, nxt);
  }

  function afterShow(name, sectionEl) {
    setProgress(SEQUENCE.indexOf(name) + 1);
    var q = quizIndex(name);
    if (q) { reflectSelection(q); syncContinue(q); }
    focusHeading(sectionEl.querySelector("h1, h2"));
    if (name === "building") runBuilding();
  }

  function next(fromName) {
    var i = SEQUENCE.indexOf(fromName);
    if (i >= 0 && i < SEQUENCE.length - 1) show(SEQUENCE[i + 1]);
  }

  /* ---- quiz interaction: select, then per-question Continue ---- */
  function reflectSelection(q) {
    $$('.btn.option[data-q="' + q + '"]').forEach(function (b) {
      var sel = !!sessionAnswered["q" + q] && state.answers["q" + q] === b.dataset.opt;
      b.classList.toggle("selected", sel);
      b.setAttribute("aria-pressed", sel ? "true" : "false");
    });
  }

  function syncContinue(q) {
    var btn = $('[data-action="q-continue"][data-q="' + q + '"]');
    if (btn) btn.disabled = !sessionAnswered["q" + q]; // disabled until answered THIS session
  }

  function onOption(btn) {
    haptic.light();
    var q = Number(btn.dataset.q);
    state.answers["q" + q] = btn.dataset.opt;
    sessionAnswered["q" + q] = true;
    store.set(STORE_KEY, state.answers);
    reflectSelection(q);
    syncContinue(q);
  }

  /* ---- building: sequenced checklist (~3s), then plan reveal off the final check ---- */
  var buildingRunning = false;

  function answerText(q) {
    var opt = state.answers["q" + q];
    if (!opt) return "";
    var btn = $('.btn.option[data-q="' + q + '"][data-opt="' + opt + '"]');
    return btn ? btn.textContent.trim() : "";
  }

  function fillPlan() {
    $$('[data-plan="a1"]').forEach(function (el) { el.textContent = answerText(1); });
    $$('[data-plan="a2"]').forEach(function (el) { el.textContent = answerText(2); });
  }

  function runBuilding() {
    if (buildingRunning) return; // a stray double-entry never restarts the sequence
    buildingRunning = true;
    var anim = $(".build-anim");
    var reveal = $(".plan-reveal");
    fillPlan();
    var steps = $$(".build-step");
    steps.forEach(function (s) { s.classList.remove("on", "done"); });
    var RING_C = 326.73;
    var ringFill = $(".ring-fill");
    var ringLabel = $(".ring-label");
    function setRing(frac) {
      if (ringFill) ringFill.style.strokeDashoffset = String(RING_C * (1 - frac));
      if (ringLabel) ringLabel.textContent = Math.round(frac * 100) + "%";
    }
    setRing(0);
    function revealPlan() {
      anim.hidden = true;
      var els = prepChoreo(reveal); // plan cards cascade in like everything else
      reveal.hidden = false;
      runChoreo(reveal, els);
      buildingRunning = false;
      focusHeading(reveal.querySelector("h2"));
    }
    anim.hidden = false; reveal.hidden = true;
    if (reduceMotionNow()) {
      // instant checkmarks + complete ring, one short beat, advance
      steps.forEach(function (s) { s.classList.add("on", "done"); });
      setRing(1);
      setTimeout(function () { haptic.success(); revealPlan(); }, 500);
      return;
    }
    var HOLD = 520, GAP = 180; // per line: rise in -> spinner beat -> checkmark
    // Ring + label fill CONTINUOUSLY across the whole sequence: one rAF tween
    // from 0 -> 100% over exactly the time until the final check resolves
    // (steps*HOLD + (steps-1)*GAP), so the number counts through every
    // integer and the stroke never pauses or jumps between resolves.
    var SEQ_TOTAL = steps.length * HOLD + (steps.length - 1) * GAP;
    var ringT0 = performance.now();
    (function ringFrame(t) {
      var p = Math.min(1, (t - ringT0) / SEQ_TOTAL);
      setRing(p);
      if (p < 1) requestAnimationFrame(ringFrame);
    })(performance.now());
    var i = 0;
    (function nextStep() {
      if (i >= steps.length) return setTimeout(revealPlan, 260); // payoff off the final check
      var s = steps[i++];
      s.classList.add("on");
      setTimeout(function () {
        s.classList.add("done");
        if (i >= steps.length) haptic.success(); else haptic.light(); // tick per resolve, success on last
        setTimeout(nextStep, GAP);
      }, HOLD);
    })();
  }

  /* ---- toast: element stays in the DOM; live region announces text change ---- */
  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ---- actions ---- */
  var actions = {
    "welcome-next": function () { haptic.light(); show("q1"); },
    "affirm-next": function () { haptic.light(); next("affirm"); },
    "building-next": function () { haptic.light(); next("building"); },
    "proof-next": function () { haptic.light(); next("proof"); },
    "notify-yes": function () { haptic.light(); next("notify"); },   // soft ask only — no permission API here
    "notify-later": function () { haptic.light(); next("notify"); },
    "paywall-cta": function () { haptic.success(); fillPlan(); show("home"); },   // PLACEHOLDER: no payment logic
    "paywall-close": function () { fillPlan(); show("home"); },
    "paywall-restore": function () {                                 // explicitly inert mock
      toast("Restore is wired up by the payments skill — nothing to restore in this preview.");
    }
  };

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    if (!hydrated) return;            // gate interaction until state hydration resolves
    if (transitioning && btn.dataset.action) return;
    var a = btn.dataset.action;
    if (a === "q-continue") {
      var q = Number(btn.dataset.q);
      if (!sessionAnswered["q" + q]) return;
      haptic.light();
      return next("q" + q);
    }
    if (a === "q-back") {
      var qb = Number(btn.dataset.q);
      return show(qb > 1 ? "q" + (qb - 1) : "welcome", true); // backward: mirrored push
    }
    if (a && actions[a]) return actions[a]();
    if (btn.classList.contains("option")) return onOption(btn);
    if (btn.classList.contains("price")) selectPrice(btn);
  });

  /* ---- price radio group: selection + roving tabindex ---- */
  function selectPrice(btn) {
    $$(".btn.price").forEach(function (b) {
      var sel = b === btn;
      b.classList.toggle("selected", sel);
      b.setAttribute("aria-checked", sel ? "true" : "false");
      b.tabIndex = sel ? 0 : -1; // roving tabindex: one tab stop for the group
    });
  }

  document.addEventListener("keydown", function (e) {
    var btn = e.target.closest && e.target.closest(".btn.price");
    if (!btn) return;
    var prices = $$(".btn.price");
    var i = prices.indexOf(btn);
    var nxt = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nxt = prices[(i + 1) % prices.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nxt = prices[(i - 1 + prices.length) % prices.length];
    if (nxt) { e.preventDefault(); selectPrice(nxt); nxt.focus(); }
  });

  var stampEl = document.getElementById("buildstamp");
  if (stampEl) stampEl.textContent = BUILD_STAMP;

  /* ---- init: hydrate durable answers, gated with a fast timeout so a hung
     native bridge can never block the app. Flow always starts at welcome. ---- */
  var hydrationTimeout = new Promise(function (res) { setTimeout(function () { res(null); }, 800); });
  Promise.race([store.get(STORE_KEY), hydrationTimeout])
    .then(function (saved) {
      state.answers = sanitizeAnswers(saved); // kept as data; never pre-selects UI on first arrival
      for (var i = 1; i <= QUIZ_TOTAL; i++) syncContinue(i); // all Continues start disabled
      fillPlan();
    })
    .catch(function () { /* hydration failure: start clean */ })
    .then(function () { hydrated = true; });
  setProgress(1); // welcome is step 1 of 14 — visibly started
})();
