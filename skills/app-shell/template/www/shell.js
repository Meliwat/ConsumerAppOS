/* app-shell — fixed skeleton logic for the main tab shell.
   Loaded after app.js; touches ONLY the shell screen (data-screen="home").
   Two bars, one brain: tab state lives here. Native bridge handshake
   succeeds → the real native tab bar drives selection (vendor/native-tabs.js);
   browser, or any native failure → the web fallback bar. Tab switches are
   INSTANT CUTS (matching Apple's own tab behavior — tabs are places, not a
   sequence); each pane keeps its own scroll position via visibility toggling. */
(function () {
  "use strict";

  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var shell = document.querySelector(".screen.shell");
  if (!shell) return;

  var panes = $$(".tab-pane", shell);
  var webTabs = $$(".tabbar .tab", shell);
  if (!panes.length || !webTabs.length) return;

  var current = webTabs[0].dataset.tab;

  var haptic = {
    light: function () { if (window.AppHaptics) window.AppHaptics.light(); }
  };

  function focusTitle(pane) {
    var h = pane.querySelector(".large-title");
    if (!h) return;
    try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }

  /* Web-bar activation follows the W3C tabs pattern: focus STAYS on the
     activated tab; the panel is reachable with Tab (panes carry tabindex="0"
     in the markup since they have no focusable content of their own). */
  function activate(id, opts) {
    if (id === current && !(opts && opts.force)) return;
    current = id;
    var activePane = null;
    panes.forEach(function (p) {
      var on = p.dataset.tab === id;
      p.classList.toggle("active", on);
      if (on) activePane = p;
    });
    webTabs.forEach(function (t) {
      var on = t.dataset.tab === id;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1; // roving tabindex: one tab stop for the bar
    });
    /* Native selections move focus to the pane title so assistive tech gets
       the context change (VoiceOver behavior still pending device
       verification); web activations keep focus on the tab per W3C. */
    if (activePane && opts && opts.focusTitle) focusTitle(activePane);
  }

  /* ---- web fallback bar: taps + Left/Right arrow roving (tablist is
     horizontal — Up/Down are left to scroll the page normally) ---- */
  webTabs.forEach(function (t) {
    t.addEventListener("click", function () {
      if (t.dataset.tab === current) return;
      haptic.light();
      activate(t.dataset.tab);
    });
  });

  document.addEventListener("keydown", function (e) {
    var t = e.target.closest && e.target.closest(".tabbar .tab");
    if (!t) return;
    var i = webTabs.indexOf(t);
    var nxt = null;
    if (e.key === "ArrowRight") nxt = webTabs[(i + 1) % webTabs.length];
    else if (e.key === "ArrowLeft") nxt = webTabs[(i - 1 + webTabs.length) % webTabs.length];
    if (nxt) { e.preventDefault(); activate(nxt.dataset.tab); nxt.focus(); }
  });

  /* ---- native mode: entered ONLY after the full handshake succeeds.
     Until (and unless) init() resolves true, the web bar stays — a broken
     native side must never leave the app barless. ---- */
  if (window.AppNativeTabs && window.AppNativeTabs.available) {
    var defs = webTabs.map(function (t) {
      var label = t.querySelector(".tab-label");
      return {
        id: t.dataset.tab,
        title: label ? label.textContent.trim() : t.dataset.tab,
        sfSymbol: t.dataset.sf
      };
    });

    window.AppNativeTabs.init(defs, current, function (id) {
      if (id === current) return;
      haptic.light();
      activate(id, { focusTitle: true });
    }).then(function (ok) {
      if (!ok) return; // handshake failed: web fallback bar remains active

      /* The native bar exists only while the shell screen is active — during
         onboarding it stays hidden. Onboarding owns screen classes; observe
         .active on the shell section rather than patching app.js.
         html.native-tabs (hides the web bar, switches pane insets to the
         native bar height) is added ONLY after the first VISIBLE setTabbar
         succeeds: a bar that registered but cannot actually show must never
         cost the app its web fallback. */
      var nativeEstablished = false;
      var shown = false;
      function syncBar() {
        var a = shell.classList.contains("active");
        if (a === shown) return;
        shown = a;
        window.AppNativeTabs.setVisible(a, current).then(function (visOk) {
          if (a && visOk && !nativeEstablished) {
            nativeEstablished = true;
            document.documentElement.classList.add("native-tabs");
          }
        });
      }
      new MutationObserver(syncBar)
        .observe(shell, { attributes: true, attributeFilter: ["class"] });
      syncBar();
    });
  }
})();
