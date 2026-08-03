/* Paywall client config. The RevenueCat PUBLIC SDK key (appl_…) is
   client-safe by design — it can only be used to fetch offerings and start
   App Store purchases for this bundle id; authorization lives server-side
   at RevenueCat. Empty string = browser previews rehearse the labeled mock
   flow, and NATIVE builds show an explicit "purchases unavailable" state
   (never mock success). Release builds must not ship an empty key.
   NEVER put here: RevenueCat secret keys (sk_…), App Store Connect .p8
   keys, or the app-specific shared secret — those never ship in a bundle.
   The adapter refuses any value not matching ^appl_[A-Za-z0-9]+$.

   Both slots are filled with JSON-SERIALIZED strings (quotes included) —
   never spliced into hand-written quotes. */
window.APP_RC_KEY = {{RC_PUBLIC_KEY_JSON}};

/* The single RevenueCat entitlement this app gates on — every entitlement
   check inspects exactly this id (customerInfo.entitlements.active[id]). */
window.APP_RC_ENTITLEMENT = {{RC_ENTITLEMENT_ID_JSON}};
