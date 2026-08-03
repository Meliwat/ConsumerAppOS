/* onboarding flow — fixed skeleton logic. Structure is canonical; do not
   add/remove/reorder screens. Content lives in index.html slots. */
(function () {
  "use strict";

  var SEQUENCE = ["welcome", "quiz", "affirm", "building", "proof", "notify", "paywall", "home"];
  var QUIZ_TOTAL = 7;
  var STORE_KEY = "onboarding.answers";
  var TRANSITION_MS = 240;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  var state = { answers: {}, qIndex: 1 };
  var hydrated = false;      // interaction gated until hydration (or timeout)
  var quizLocked = false;    // blocks double-tap double-advance
  var transitioning = false; // blocks re-entrant screen changes

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

  /* Whole-flow progress: 14 equal units — welcome(1), quiz Q1-Q7 (2-8),
     affirm(9), building(10), proof(11), notify(12), paywall(13), home(14).
     Visibly filled from step 1, full at the final screen; aria stays in sync. */
  var TOTAL_STEPS = 14;
  var SCREEN_STEP = { welcome: 1, affirm: 9, building: 10, proof: 11, notify: 12, paywall: 13, home: 14 };
  function setProgress(step) {
    progressFill.style.width = (step / TOTAL_STEPS * 100) + "%";
    progressTrack.setAttribute("aria-valuenow", String(step));
  }

  /* Restored state must be shaped exactly like we saved it: keys q1..q5,
     values "1".."3". Anything else is dropped, never trusted. */
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

  /* ---- screen lifecycle: enter/leave classes; display:none can't animate ---- */
  function show(name) {
    var cur = $(".screen.active");
    var nxt = $('.screen[data-screen="' + name + '"]');
    if (!nxt || cur === nxt) return;
    if (reduceMotion || !cur) {
      if (cur) cur.classList.remove("active");
      nxt.classList.add("active");
      afterShow(name, nxt);
      return;
    }
    transitioning = true;
    cur.classList.add("leaving");
    cur.classList.remove("active");
    nxt.classList.add("enter", "active");
    // double rAF: let the enter state paint, then transition to active
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { nxt.classList.remove("enter"); });
    });
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      cur.removeEventListener("transitionend", onEnd);
      cur.classList.remove("leaving");
      transitioning = false;
    }
    // transitionend bubbles from descendants: only the outgoing screen's own
    // opacity transition counts. Filter without {once:true} so a bubbled
    // event can't consume the listener; the timeout is the guaranteed path.
    function onEnd(ev) {
      if (ev.target === cur && ev.propertyName === "opacity") finish();
    }
    cur.addEventListener("transitionend", onEnd);
    setTimeout(finish, TRANSITION_MS + 80);
    afterShow(name, nxt);
  }

  function afterShow(name, sectionEl) {
    setProgress(name === "quiz" ? 1 + state.qIndex : SCREEN_STEP[name]);
    var heading = name === "quiz"
      ? $('.quiz-step[data-q="' + state.qIndex + '"] h2')
      : sectionEl.querySelector("h1, h2");
    if (heading) heading.focus();
    if (name === "building") runBuilding();
  }

  function next(fromName) {
    var i = SEQUENCE.indexOf(fromName);
    if (i >= 0 && i < SEQUENCE.length - 1) show(SEQUENCE[i + 1]);
  }

  /* ---- quiz ---- */
  function showQuizStep(n) {
    var cur = $(".quiz-step.active");
    var nxt = $('.quiz-step[data-q="' + n + '"]');
    state.qIndex = n;
    if (nxt && cur !== nxt) {
      if (reduceMotion || !cur) {
        if (cur) cur.classList.remove("active");
        nxt.classList.add("active");
      } else {
        cur.classList.add("leaving");
        cur.classList.remove("active");
        nxt.classList.add("enter", "active");
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { nxt.classList.remove("enter"); });
        });
        setTimeout(function () { cur.classList.remove("leaving"); }, TRANSITION_MS + 80);
      }
    }
    $(".back-btn").hidden = n < 2;
    setProgress(1 + n);
    reflectSelection(n);
    syncQuizContinue();
    var h = $('.quiz-step[data-q="' + n + '"] h2');
    if (h) h.focus();
    quizLocked = false;
  }

  function reflectSelection(q) {
    $$('.btn.option[data-q="' + q + '"]').forEach(function (b) {
      var sel = state.answers["q" + q] === b.dataset.opt;
      b.classList.toggle("selected", sel);
      b.setAttribute("aria-pressed", sel ? "true" : "false");
      b.disabled = false;
    });
  }

  function syncQuizContinue() {
    var btn = $('[data-action="quiz-continue"]');
    if (btn) btn.disabled = !state.answers["q" + state.qIndex];
  }

  function answerText(q) {
    var opt = state.answers["q" + q];
    if (!opt) return "";
    var btn = $('.btn.option[data-q="' + q + '"][data-opt="' + opt + '"]');
    return btn ? btn.textContent.trim() : "";
  }

  /* Select + Continue: tapping an option selects it (changeable until
     Continue); advancing is the Continue button's job. */
  function onOption(btn) {
    haptic.light();
    var q = Number(btn.dataset.q);
    state.answers["q" + q] = btn.dataset.opt;
    store.set(STORE_KEY, state.answers);
    reflectSelection(q);
    syncQuizContinue();
  }

  function onQuizContinue() {
    if (quizLocked) return; // double-tap cannot double-advance
    if (!state.answers["q" + state.qIndex]) return;
    quizLocked = true;
    haptic.light();
    if (state.qIndex < QUIZ_TOTAL) showQuizStep(state.qIndex + 1);
    else { quizLocked = false; next("quiz"); }
  }

  /* ---- building: 3s ring + 3 staged captions, then plan reveal ---- */
  var buildingRunning = false;

  function fillPlan() {
    $$('[data-plan="a1"]').forEach(function (el) { el.textContent = answerText(1); });
    $$('[data-plan="a2"]').forEach(function (el) { el.textContent = answerText(2); });
  }

  function runBuilding() {
    if (buildingRunning) return; // a stray double-entry never restarts the animation
    buildingRunning = true;
    var anim = $(".build-anim");
    var reveal = $(".plan-reveal");
    fillPlan();
    function revealPlan() {
      anim.hidden = true;
      reveal.hidden = false;
      buildingRunning = false;
      haptic.success();
      var h = reveal.querySelector("h2");
      if (h) h.focus();
    }
    if (reduceMotion) return revealPlan(); // skip straight to the end state
    anim.hidden = false; reveal.hidden = true;
    var ring = $(".ring");
    var pctEl = $(".ring-pct");
    var caption = $(".build-caption");
    var captions = [caption.textContent, caption.dataset.c2, caption.dataset.c3];
    var t0 = performance.now();
    var DURATION = 3000;
    function frame(t) {
      var p = Math.min(1, (t - t0) / DURATION);
      var pct = Math.round(p * 100);
      ring.style.setProperty("--pct", pct);
      pctEl.textContent = pct + "%";
      caption.textContent = captions[Math.min(2, Math.floor(p * 3))];
      if (p < 1) requestAnimationFrame(frame);
      else revealPlan();
    }
    requestAnimationFrame(frame);
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
    "welcome-next": function () { haptic.light(); state.qIndex = 1; show("quiz"); showQuizStep(1); },
    "quiz-back": function () { if (state.qIndex > 1) showQuizStep(state.qIndex - 1); },
    "quiz-continue": onQuizContinue,
    "affirm-next": function () { haptic.light(); next("affirm"); },
    "building-next": function () { haptic.light(); next("building"); },
    "proof-next": function () { haptic.light(); next("proof"); },
    "notify-yes": function () { haptic.light(); next("notify"); },   // soft ask only — no permission API here
    "notify-later": function () { haptic.light(); next("notify"); },
    "paywall-cta": function () { haptic.success(); fillPlan(); show("home"); },   // PLACEHOLDER: no payment logic
    "paywall-close": function () { fillPlan(); show("home"); },
    "paywall-restore": function () {                            // explicitly inert mock
      toast("Restore is wired up by the payments skill — nothing to restore in this preview.");
    }
  };

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    if (!hydrated) return;      // gate interaction until state hydration resolves
    if (transitioning && btn.dataset.action) return;
    if (btn.dataset.action && actions[btn.dataset.action]) return actions[btn.dataset.action]();
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

  /* ---- init: hydrate durable answers, gated with a fast timeout so a hung
     native bridge can never block the app. Flow always starts at welcome. ---- */
  var hydrationTimeout = new Promise(function (res) { setTimeout(function () { res(null); }, 800); });
  Promise.race([store.get(STORE_KEY), hydrationTimeout])
    .then(function (saved) {
      state.answers = sanitizeAnswers(saved);
      fillPlan();
    })
    .catch(function () { /* hydration failure: start clean */ })
    .then(function () { hydrated = true; });
  setProgress(1); // welcome is step 1 of 11 — visibly started
})();
