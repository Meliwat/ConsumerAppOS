/* vendor/haptics.js — browser-ready haptics wrapper (repo plugin convention).
   Native: Capacitor's injected bridge exposes window.Capacitor.Plugins.Haptics
   once @capacitor/haptics is installed (npm + cap sync — the testflight skill
   owns that). No ESM import needed: the bridge registers the plugin itself.
   Browser: falls back to navigator.vibrate where available, else no-op.
   Haptics must NEVER break the app — every path is guarded. */
(function () {
  "use strict";
  function nativeHaptics() {
    var C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Haptics) || null;
  }
  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }
  window.AppHaptics = {
    /* light tap — selections, screen advances */
    light: function () {
      var H = nativeHaptics();
      try {
        if (H) H.impact({ style: "LIGHT" });
        else vibrate(10);
      } catch (e) {}
    },
    /* success notification — plan reveal, purchase CTA */
    success: function () {
      var H = nativeHaptics();
      try {
        if (H) H.notification({ type: "SUCCESS" });
        else vibrate([15, 60, 20]);
      } catch (e) {}
    }
  };
})();
