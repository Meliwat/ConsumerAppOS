/* vendor/purchases.js — purchases adapter (repo plugin convention).
   Native half: @revenuecat/purchases-capacitor (npm + cap sync, pinned
   13.3.0) — the bridge registers it as window.Capacitor.Plugins.Purchases,
   so no ESM import is needed. JS half: this wrapper.

   THREE worlds, decided lazily on every call (nothing cached at load):
   - "store":       native platform + Purchases bridge + publishable key
   - "mock":        a CONFIRMED browser (not a native platform) — the whole
                    flow is rehearsed with labeled mock data
   - "unavailable": a native context missing the key or the bridge, OR any
                    indeterminate environment (missing/malformed/throwing
                    platform detector) — money paths return typed
                    unavailable results; mock success requires a CONFIRMED
                    browser, nothing less.

   Typed results everywhere (no error-as-denial collapses):
   - checkEntitlement → {status:"active"|"inactive"|"unknown", source, error?}
   - restore          → {status:"restored"|"none"|"error", source, error?}
   - purchase         → {outcome:"purchased"|"cancelled"|"unavailable"|
                         "unconfirmed"|"error", source, error?}
   The entitlement inspected is EXACTLY the configured one
   (window.APP_RC_ENTITLEMENT), never "any active entitlement".

   Bridge trap (production-verified): configure / setLogLevel / setEmail are
   CAPPluginReturnNone natively — on the raw bridge they return undefined,
   NOT a promise. Never chain .then on them. */
(function () {
  "use strict";

  var CONFIGURE_SETTLE_MS = 400;
  var MOCK_OFFERINGS_MS = 350;
  var MOCK_PURCHASE_MS = 900;

  /* World detection. ONLY an EXPLICIT confirmed-browser state maps to
     mock: no Capacitor object at all, or a working detector answering
     exactly false. A missing detector, malformed Capacitor object,
     detector exception, or any indeterminate answer is "indeterminate" —
     and indeterminate money paths are UNAVAILABLE, never mock. */
  function world() {
    try {
      var C = window.Capacitor;
      if (C === undefined || C === null) return "browser"; // no bridge injection: confirmed browser
      if (typeof C.isNativePlatform !== "function") return "indeterminate";
      var r = C.isNativePlatform();
      if (r === true) return "native";
      if (r === false) return "browser"; // Capacitor web runtime: confirmed browser
      return "indeterminate";
    } catch (e) { return "indeterminate"; }
  }
  function bridge() {
    try {
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.Purchases) || null;
    } catch (e) { return null; }
  }
  /* Key gate: only a well-formed PUBLIC SDK key counts. A secret-shaped or
     malformed value is refused up front (unavailable + diagnostic) — in
     every build, not just release. */
  function validKey() {
    var k = window.APP_RC_KEY;
    if (typeof k !== "string" || k === "") return null;
    if (!/^appl_[A-Za-z0-9]+$/.test(k)) {
      try { console.warn("[purchases] APP_RC_KEY is not a valid public SDK key (appl_…) — purchases unavailable. Never ship secret keys."); } catch (e) {}
      return null;
    }
    return k;
  }
  function entId() {
    return (typeof window.APP_RC_ENTITLEMENT === "string" && window.APP_RC_ENTITLEMENT) || "pro";
  }
  function mode() {
    var w = world();
    if (w === "browser") return "mock";
    if (w === "native") return (bridge() && validKey()) ? "store" : "unavailable";
    return "unavailable"; // indeterminate: never mock, never store
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function errText(e) { return String((e && e.message) || e).slice(0, 160); }

  /* Product-ID convention: <appId>.pro.yearly / <appId>.pro.monthly. */
  function planOfProduct(id) {
    if (/\.pro\.yearly$/.test(id || "")) return "yearly";
    if (/\.pro\.monthly$/.test(id || "")) return "monthly";
    return null;
  }
  function pkgProduct(pkg) { return (pkg && (pkg.product || pkg.storeProduct)) || null; }

  function periodLabel(iso) {
    var m = /^P(\d+)([DWMY])$/i.exec(String(iso || ""));
    if (!m) return null;
    var n = Number(m[1]);
    var unit = { D: "day", W: "week", M: "month", Y: "year" }[m[2].toUpperCase()];
    return n === 1 ? unit : n + " " + unit + "s";
  }

  var ready = null;
  function attemptInit(P, key) {
    try {
      try { P.setLogLevel({ level: "DEBUG" }); } catch (e) { /* diagnostics only */ }
      P.configure({ apiKey: key }); // returns undefined — do not chain
      return sleep(CONFIGURE_SETTLE_MS).then(function () { return P; });
    } catch (e) {
      try { console.warn("[purchases] configure failed:", e); } catch (x) {}
      return Promise.resolve(null);
    }
  }
  function init() {
    var P = bridge(), key = validKey();
    if (!P || !key) return Promise.resolve(null);
    if (!ready) {
      /* the retry reset happens AFTER the attempt settles — resetting
         inside the attempt would be overwritten by this assignment */
      ready = attemptInit(P, key).then(function (configured) {
        if (!configured) ready = null; // failed configure → next call retries
        return configured;
      });
    }
    return ready;
  }

  function entitlementIn(customerInfo) {
    var act = customerInfo && customerInfo.entitlements && customerInfo.entitlements.active;
    return !!(act && Object.prototype.hasOwnProperty.call(act, entId()));
  }

  /* Cancellation is recognized ONLY via RevenueCat's explicit signals —
     the userCancelled flag or the PURCHASE_CANCELLED error code (1). Never
     by pattern-matching message text. */
  function isExplicitCancel(e) {
    if (!e) return false;
    if (e.userCancelled === true) return true;
    var code = e.code !== undefined ? e.code : (e.errorCode !== undefined ? e.errorCode : undefined);
    return code === 1 || code === "1" || code === "PURCHASE_CANCELLED" ||
           code === "PURCHASE_CANCELLED_ERROR" || code === "PurchasesErrorCode.purchaseCancelledError";
  }

  /* Eligibility statuses per RevenueCat: 2 / *_ELIGIBLE means eligible. */
  function isEligibleStatus(entry) {
    var s = entry && entry.status;
    return Number(s) === 2 || /ELIGIBLE$/.test(String(s || "")) && !/INELIGIBLE$/.test(String(s || ""));
  }

  /* ---- mock world (browser rehearsal; always labeled by the caller) ---- */
  function mockPlans() {
    return {
      yearly: { valid: true, productId: "(mock).pro.yearly", priceString: "$29.99",
                periodLabel: "year", trialEligible: true, trialDuration: "3 days", pkg: null },
      monthly: { valid: true, productId: "(mock).pro.monthly", priceString: "$4.99",
                 periodLabel: "month", trialEligible: false, trialDuration: null, pkg: null }
    };
  }

  window.AppPurchases = {
    mode: mode,
    entitlementId: entId,

    /* → resolves { source, plans } where each plan is
         { valid, productId, priceString, periodLabel, trialEligible,
           trialDuration, pkg }
       Store: validation is per-plan (id convention + nonempty localized
       price + parseable period); trial fields come ONLY from a verified
       eligibility check — unknown eligibility renders as normal pricing
       (RevenueCat's own recommendation). Rejects when nothing usable
       exists or the world is "unavailable". */
    getOfferings: function () {
      var m = mode();
      if (m === "mock") return sleep(MOCK_OFFERINGS_MS).then(function () {
        return { source: "mock", plans: mockPlans() };
      });
      if (m === "unavailable") return Promise.reject(new Error("purchases unavailable (no key or bridge)"));
      return init().then(function (P) {
        if (!P) throw new Error("purchases not configured");
        return P.getOfferings().then(function (offerings) {
          var packages = (offerings && offerings.current && offerings.current.availablePackages) || [];
          var plans = {};
          packages.forEach(function (pkg) {
            var product = pkgProduct(pkg);
            var plan = product && planOfProduct(product.identifier);
            if (!plan || plans[plan]) return;
            var pl = periodLabel(product.subscriptionPeriod);
            var priceOk = typeof product.priceString === "string" && product.priceString.trim() !== "";
            plans[plan] = {
              valid: !!(priceOk && pl),
              productId: product.identifier,
              priceString: product.priceString,
              periodLabel: pl,
              trialEligible: false,   // until the eligibility check says otherwise
              trialDuration: null,
              introPeriod: product.introPrice && Number(product.introPrice.price) === 0
                ? product.introPrice.period : null,
              pkg: pkg
            };
          });
          var ids = Object.keys(plans).map(function (k) { return plans[k].productId; });
          if (!ids.length) throw new Error("subscription products unavailable");
          var eligibility = (typeof P.checkTrialOrIntroductoryPriceEligibility === "function")
            ? Promise.resolve(P.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: ids }))
                .catch(function (e) {
                  try { console.warn("[purchases] eligibility unknown, showing standard pricing:", e); } catch (x) {}
                  return {};
                })
            : Promise.resolve({});
          return eligibility.then(function (elig) {
            Object.keys(plans).forEach(function (k) {
              var p = plans[k];
              if (p.introPeriod && isEligibleStatus(elig && elig[p.productId])) {
                p.trialEligible = true;
                p.trialDuration = periodLabel(p.introPeriod);
                if (!p.trialDuration) p.trialEligible = false; // unparseable → no claim
              }
              delete p.introPeriod;
            });
            return { source: "store", plans: plans };
          });
        });
      });
    },

    purchase: function (plan) {
      var self = this;
      var m = mode();
      if (m === "mock") return sleep(MOCK_PURCHASE_MS).then(function () {
        return { outcome: "purchased", source: "mock" };
      });
      if (m === "unavailable") return Promise.resolve({ outcome: "unavailable", source: "unavailable" });
      return init().then(function (P) {
        if (!P) return { outcome: "unavailable", source: "store" };
        return self.getOfferings().then(function (res) {
          var entry = res.plans[plan];
          if (!entry || !entry.valid || !entry.pkg) return { outcome: "unavailable", source: "store" };
          return P.purchasePackage({ aPackage: entry.pkg }).then(function (r) {
            return entitlementIn(r && r.customerInfo)
              ? { outcome: "purchased", source: "store" }
              : { outcome: "unconfirmed", source: "store", error: "purchase returned without the entitlement" };
          }).catch(function (e) {
            if (isExplicitCancel(e)) return { outcome: "cancelled", source: "store" };
            /* Ambiguous failure: StoreKit MAY have charged. Re-check the
               entitlement before deciding what to tell the user. */
            try { console.warn("[purchases] purchase failed, re-checking entitlement:", e); } catch (x) {}
            return self.checkEntitlement().then(function (chk) {
              if (chk.status === "active") return { outcome: "purchased", source: "store" };
              return { outcome: "unconfirmed", source: "store", error: errText(e) };
            });
          });
        });
      }).catch(function (e) {
        try { console.warn("[purchases] purchase unavailable:", e); } catch (x) {}
        return { outcome: "unavailable", source: "store", error: errText(e) };
      });
    },

    /* mockPurchaseHistory: the caller's persisted record of a mock
       purchase — restore in the mock world answers from THAT (independent
       of the entitlement flag), so positive restore is rehearsable. */
    restore: function (mockPurchaseHistory) {
      var m = mode();
      if (m === "mock") return sleep(400).then(function () {
        return { status: mockPurchaseHistory ? "restored" : "none", source: "mock" };
      });
      if (m === "unavailable") return Promise.resolve({ status: "error", source: "unavailable", error: "purchases unavailable" });
      return init().then(function (P) {
        if (!P) return { status: "error", source: "store", error: "not configured" };
        return P.restorePurchases().then(function (r) {
          return entitlementIn(r && r.customerInfo)
            ? { status: "restored", source: "store" }
            : { status: "none", source: "store" }; // VERIFIED empty — distinct from failure
        });
      }).catch(function (e) { // terminal: sync bridge throws land here too
        try { console.warn("[purchases] restore failed:", e); } catch (x) {}
        return { status: "error", source: "store", error: errText(e) };
      });
    },

    /* Fresh-answer contract: cache invalidation must SUCCEED before the
       fetch — "active"/"inactive" are only ever claimed about a freshly
       fetched answer. If invalidation is missing, throws, or rejects, the
       result is typed "unknown" (the caller retains last-known access);
       a possibly-cached answer is never labeled freshly verified. */
    checkEntitlement: function () {
      var m = mode();
      if (m !== "store") {
        return Promise.resolve({ status: "unknown", source: m, error: m === "mock" ? undefined : "purchases unavailable" });
      }
      return init().then(function (P) {
        if (!P) return { status: "unknown", source: "store", error: "not configured" };
        return Promise.resolve().then(function () {
          if (typeof P.invalidateCustomerInfoCache !== "function") {
            throw new Error("cache invalidation unavailable — cannot guarantee a fresh verdict");
          }
          return P.invalidateCustomerInfoCache(); // must settle successfully first
        }).then(function () {
          return P.getCustomerInfo().then(function (r) {
            return entitlementIn(r && r.customerInfo)
              ? { status: "active", source: "store" }
              : { status: "inactive", source: "store" }; // VERIFIED inactive, freshly fetched
          });
        });
      }).catch(function (e) { // invalidation failures and sync bridge throws land here
        return { status: "unknown", source: "store", error: errText(e) };
      });
    }
  };
})();
