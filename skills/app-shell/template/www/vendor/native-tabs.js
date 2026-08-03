/* vendor/native-tabs.js — native tab bar adapter (repo plugin convention,
   sanctioned-difference case). Native half: @capgo/capacitor-native-navigation
   (npm + cap sync — the app-shell skill owns installing it, pinned 8.3.0).
   On iOS 26+ it hosts the system UITabBar/UITabBarController and iOS renders
   its own Liquid Glass; on iOS 15–25 the plugin draws its own native UIKit
   floating tab bar (native, but not Apple's component). JS half: this wrapper
   over the injected bridge — window.Capacitor.Plugins.NativeNavigation. No
   ESM import needed.

   FAIL-SAFE CONTRACT: init() resolves true only after the full native
   handshake succeeds (version probe, configure, listener, initial setTabbar).
   Any failure resolves false with a console diagnostic — the caller must keep
   the web fallback bar in that case. A broken native side must never leave
   the app barless. Browser: available=false, init resolves false, the web
   fallback bar in shell.css stands in. */
(function () {
  "use strict";

  function plugin() {
    var C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() &&
            C.Plugins && C.Plugins.NativeNavigation) || null;
  }

  function toNativeTabs(tabs) {
    return tabs.map(function (t) {
      return { id: t.id, title: t.title, icon: { ios: { sfSymbol: t.sfSymbol } } };
    });
  }

  var lastTabs = [];

  window.AppNativeTabs = {
    available: !!plugin(),

    /* Full handshake, then hidden tab registration (the bar is shown only
       when the shell screen is active — setVisible). contentInsetMode "css":
       the plugin writes --cap-native-tabbar-height on <html>, which shell.css
       uses to inset the pane scrollers. Resolves true ONLY on success. */
    init: function (tabs, selectedId, onSelect) {
      var P = plugin();
      if (!P) return Promise.resolve(false);
      lastTabs = tabs;
      return Promise.resolve()
        .then(function () { return P.getPluginVersion(); })
        .then(function () { return P.configure({ enabled: true, contentInsetMode: "css" }); })
        .then(function () {
          return P.addListener("tabSelect", function (ev) {
            try { if (ev && ev.id && onSelect) onSelect(ev.id); } catch (e) {}
          });
        })
        .then(function () {
          return P.setTabbar({ hidden: true, tabs: toNativeTabs(tabs), selectedId: selectedId });
        })
        .then(function () { return true; })
        .catch(function (err) {
          try { console.warn("[native-tabs] native bar unavailable, keeping web fallback:", err); } catch (e) {}
          return false;
        });
    },

    /* Show/hide the native bar (shell active <-> onboarding screens).
       setTabbar is FULL state replacement — tabs must always be re-sent.
       Resolves true only when the native side accepted the update; the
       caller gates html.native-tabs on the first successful VISIBLE call,
       so a bar that registers but cannot show never hides the web bar. */
    setVisible: function (visible, selectedId) {
      var P = plugin();
      if (!P) return Promise.resolve(false);
      return Promise.resolve()
        .then(function () {
          return P.setTabbar({ hidden: !visible, tabs: toNativeTabs(lastTabs), selectedId: selectedId });
        })
        .then(function () { return true; })
        .catch(function (err) {
          try { console.warn("[native-tabs] setTabbar(visible=" + visible + ") failed, web fallback stands:", err); } catch (e) {}
          return false;
        });
    }
  };
})();
