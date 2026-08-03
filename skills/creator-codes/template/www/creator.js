/* creator.js — creator-code attribution with no owned backend.
   Loaded LAST. Composes with onboarding (the creator screen is a real
   step in SEQUENCE — spliced there by this skill) and, when present, with
   the paywall skill's RevenueCat setup.

   MODEL: the code list is PUBLIC static JSON (codes.json on a static
   host). Submitting a code NEVER blocks onboarding: if the list is
   loaded, the code validates live; otherwise it is saved as PENDING and
   re-validated on a later launch. The code is attached to RevenueCat as
   subscriber attributes (creator_code / creator_code_status) — it then
   appears on customer profiles and in Scheduled Data Exports, where
   revenue-per-creator is computed. Re-asserted every launch.

   CODE SYNTAX (enforced in HTML and here — nonconforming input is never
   persisted and never reaches setAttributes): 2–24 chars of A–Z, 0–9,
   hyphen, underscore, after trim+uppercase.

   PERSISTENCE (atomic, revision-authoritative): ONE JSON record
   {code, status, name, rev} under a single key, where rev is a monotonic
   counter. A synchronous localStorage/memory shadow is written BEFORE
   navigation can proceed; the Preferences write follows. On read, BOTH
   sources are consulted and the HIGHER revision wins — a nonempty shadow
   newer than Preferences is authoritative until Preferences confirms the
   same revision, and launch write-through retries the Preferences write
   until it does. A record with a missing/invalid status reads as pending.
   persisted:"memory" is reported honestly: a memory-only record lives
   ONLY until the app terminates — if every durable store is unavailable
   when the app dies, the record is lost. While it exists, durable-write
   retries run WITHIN the session (on an interval and on the next user
   interaction), stopping as soon as any durable layer accepts the write.

   HONESTY NOTE on attribution: setAttributes is CAPPluginReturnNone on
   the raw bridge — it returns undefined (despite the TypeScript
   Promise<void> type), so delivery is not client-confirmable. The
   strongest truthful result is "attempted"; attributes are re-asserted
   every launch (idempotent server-side). */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var FETCH_TIMEOUT_MS = 4000;
  var ATTRIB_DELAY_MS = 3000; // gives the paywall's launch reconcile time to configure RC

  var RECORD_KEY = "creator.record";     // atomic {code, status, name}
  var ATTRIB_KEY = "creator.lastAttrib"; // diagnostic only

  var CODE_RE = /^[A-Z0-9_-]{2,24}$/;
  var STATUSES = { valid: 1, pending: 1, unrecognized: 1 };

  function normalize(code) { return String(code || "").trim().toUpperCase(); }

  /* ---- atomic record persistence ---- */
  var memRecord = null; // in-memory shadow (last resort)

  function sanitizeRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    var code = normalize(raw.code);
    if (!CODE_RE.test(code)) return null; // invalid code syntax → no record
    var rev = raw.rev;
    if (typeof rev !== "number" || !isFinite(rev) || rev < 0 || Math.floor(rev) !== rev) rev = 0;
    return {
      code: code,
      status: STATUSES[raw.status] ? raw.status : "pending", // invalid/missing status = pending
      name: typeof raw.name === "string" ? raw.name : "",
      rev: rev
    };
  }
  var currentRev = 0; // highest revision seen this session

  function shadowRecordSync() {
    try { return parseRecord(localStorage.getItem(RECORD_KEY)); } catch (e) { return null; }
  }

  function prefs() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) || null; }
    catch (e) { return null; }
  }

  /* Synchronous shadow FIRST (memory + localStorage), then the async
     Preferences write. The new record's revision is strictly greater than
     every revision seen so far (memory, shadow, last load).
     → {persisted: "preferences"|"shadow"|"memory"} — "memory" means the
     record exists only until the app terminates; same-session durable
     retries are scheduled and the caller is told. */
  function saveRecord(rec) {
    var record = sanitizeRecord(rec);
    if (!record) return Promise.resolve({ persisted: "none", error: "invalid record" });
    var sh = shadowRecordSync();
    record.rev = Math.max(currentRev, sh ? sh.rev : 0) + 1;
    currentRev = record.rev;
    memRecord = record;
    var json = JSON.stringify(record);
    var shadowOk = false;
    try { localStorage.setItem(RECORD_KEY, json); shadowOk = true; } catch (e) {}
    var P = prefs();
    var result = function (persisted) {
      if (persisted === "memory") startDurableRetry(); // same-session retries while memRecord exists
      return { persisted: persisted };
    };
    if (!P) return Promise.resolve(result(shadowOk ? "shadow" : "memory"));
    return Promise.resolve().then(function () {
      return P.set({ key: RECORD_KEY, value: json });
    }).then(function () {
      return result("preferences");
    }).catch(function () {
      return result(shadowOk ? "shadow" : "memory"); // rejection → shadow stands
    });
  }

  /* ---- same-session durable-write retry (memory-only records) ----
     Re-attempts BOTH durable layers with the in-memory record verbatim
     (revision unchanged) on a slow interval and on the next user
     interaction; stops as soon as any durable layer accepts. */
  var DURABLE_RETRY_MS = 15000;
  var retryState = null;
  function stopDurableRetry() {
    if (!retryState) return;
    clearInterval(retryState.timer);
    document.removeEventListener("pointerdown", retryState.onInteract, true);
    document.removeEventListener("keydown", retryState.onInteract, true);
    retryState = null;
  }
  function attemptDurableWrite() {
    if (!memRecord) { stopDurableRetry(); return Promise.resolve({ persisted: "none" }); }
    var json = JSON.stringify(memRecord);
    var shadowOk = false;
    try { localStorage.setItem(RECORD_KEY, json); shadowOk = true; } catch (e) {}
    var P = prefs();
    var prefsAttempt = !P ? Promise.resolve(false)
      : Promise.resolve().then(function () { return P.set({ key: RECORD_KEY, value: json }); })
          .then(function () { return true; }).catch(function () { return false; });
    return prefsAttempt.then(function (prefsOk) {
      if (prefsOk || shadowOk) {
        stopDurableRetry();
        try { console.info("[creator-codes] durable write succeeded on retry (" + (prefsOk ? "preferences" : "shadow") + ")"); } catch (e) {}
      }
      return { persisted: prefsOk ? "preferences" : (shadowOk ? "shadow" : "memory") };
    });
  }
  function startDurableRetry() {
    if (retryState) return;
    var onInteract = function () { attemptDurableWrite(); };
    retryState = { timer: setInterval(attemptDurableWrite, DURABLE_RETRY_MS), onInteract: onInteract };
    document.addEventListener("pointerdown", onInteract, true);
    document.addEventListener("keydown", onInteract, true);
  }

  /* Production save path: the typed result is surfaced, never ignored. */
  function persistRecord(rec) {
    return saveRecord(rec).then(function (res) {
      if (res.persisted === "memory") {
        try { console.warn("[creator-codes] code saved in memory only — every durable store is unavailable; retrying this session (lost if the app terminates first)"); } catch (e) {}
      }
      return res;
    });
  }

  function parseRecord(json) {
    if (typeof json !== "string" || !json) return null;
    try { return sanitizeRecord(JSON.parse(json)); } catch (e) { return null; }
  }

  /* Revision authority: read BOTH sources; the higher rev wins (ties go
     to Preferences — it's the durable store). A winning shadow that
     Preferences hasn't confirmed is written through on launch; if that
     heal fails, the next launch retries. */
  function loadRecord() {
    var P = prefs();
    var shadow = shadowRecordSync() || memRecord;
    var finish = function (winner) {
      if (winner) currentRev = Math.max(currentRev, winner.rev);
      memRecord = winner || memRecord;
      return winner;
    };
    if (!P) return Promise.resolve(finish(shadow));
    return Promise.resolve().then(function () {
      return P.get({ key: RECORD_KEY });
    }).then(function (r) {
      var stored = parseRecord(r && r.value);
      var winner;
      if (stored && shadow) winner = shadow.rev > stored.rev ? shadow : stored;
      else winner = stored || shadow;
      if (winner && (!stored || stored.rev < winner.rev)) {
        /* shadow is ahead of Preferences: write through so durability
           catches up; failure is retried on the next launch */
        try {
          Promise.resolve(P.set({ key: RECORD_KEY, value: JSON.stringify(winner) }))
            .catch(function (e) { try { console.warn("[creator-codes] write-through retry pending:", e); } catch (x) {} });
        } catch (e) {}
      }
      return finish(winner);
    }).catch(function () {
      return finish(shadow);
    });
  }

  function saveAttribDiag(v) {
    try { localStorage.setItem(ATTRIB_KEY, v); } catch (e) {}
    var P = prefs();
    if (P) { try { Promise.resolve(P.set({ key: ATTRIB_KEY, value: v })).catch(function () {}); } catch (e) {} }
  }

  /* ---- world guards (same rules as the paywall adapter: mock behavior
     needs a CONFIRMED browser; anything indeterminate defers) ---- */
  function confirmedBrowser() {
    try {
      var C = window.Capacitor;
      if (C === undefined || C === null) return true;
      if (typeof C.isNativePlatform !== "function") return false;
      return C.isNativePlatform() === false;
    } catch (e) { return false; }
  }
  function purchasesBridge() {
    try {
      var C = window.Capacitor;
      if (!C || typeof C.isNativePlatform !== "function" || C.isNativePlatform() !== true) return null;
      return (C.Plugins && C.Plugins.Purchases) || null;
    } catch (e) { return null; }
  }
  function rcKeyValid() {
    var k = window.APP_RC_KEY;
    return typeof k === "string" && /^appl_[A-Za-z0-9]+$/.test(k);
  }

  /* ---- typed codes fetch: {status:"ok", byCode} | {status:"error", error}
     Trampoline (sync throws become typed errors) + a HARD timeout race
     independent of AbortController support (the controller additionally
     cancels the request where available). STRICT document validation:
     array; every entry has EXACTLY the four public fields with correct
     types; codes nonempty, syntax-conforming, unique after normalization.
     Any malformed entry fails the WHOLE document — never a silently-empty
     ok. ---- */
  var codesCache = null;
  var ALLOWED_FIELDS = { code: 1, creator: 1, handle: 1, active: 1 };

  function validateDocument(data) {
    if (!Array.isArray(data)) throw new Error("codes.json is not an array");
    var byCode = {};
    data.forEach(function (entry, i) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("entry " + i + " is not an object");
      Object.keys(entry).forEach(function (k) {
        if (!ALLOWED_FIELDS[k]) throw new Error("entry " + i + " has unexpected field '" + k + "'");
      });
      if (typeof entry.code !== "string" || !entry.code) throw new Error("entry " + i + ": code must be a nonempty string");
      var code = normalize(entry.code);
      if (!CODE_RE.test(code)) throw new Error("entry " + i + ": code '" + entry.code + "' violates the code syntax");
      if (byCode[code] !== undefined) throw new Error("duplicate code '" + code + "'");
      if (typeof entry.creator !== "string") throw new Error("entry " + i + ": creator must be a string");
      if (typeof entry.handle !== "string") throw new Error("entry " + i + ": handle must be a string");
      if (typeof entry.active !== "boolean") throw new Error("entry " + i + ": active must be a boolean");
      byCode[code] = entry.active ? { creator: entry.creator, handle: entry.handle } : null; // inactive kept as null → unrecognized
    });
    return byCode;
  }

  function fetchCodes() {
    return Promise.resolve().then(function () {
      var url = window.APP_CODES_URL;
      if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
        return { status: "error", error: "codes url not configured" };
      }
      var ctrl = null;
      try { if (typeof AbortController === "function") ctrl = new AbortController(); } catch (e) {}
      var request = fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (data) {
        var byCode = validateDocument(data);
        codesCache = byCode;
        return { status: "ok", byCode: byCode };
      });
      var timeout = new Promise(function (_, reject) {
        setTimeout(function () {
          try { if (ctrl) ctrl.abort(); } catch (e) {}
          reject(new Error("codes fetch timed out"));
        }, FETCH_TIMEOUT_MS);
      });
      return Promise.race([request, timeout]);
    }).catch(function (e) {
      return { status: "error", error: String((e && e.message) || e).slice(0, 160) };
    });
  }

  /* lookup: undefined = unknown code; null = known-but-inactive */
  function lookup(code) {
    if (!codesCache) return undefined;
    var hit = codesCache[normalize(code)];
    return hit === undefined || hit === null ? undefined : hit;
  }

  /* ---- attribution: {status:"attempted"|"deferred"|"mock"|"error"} ----
     Only syntax-valid codes and enum-valid statuses ever reach
     setAttributes. */
  function attemptAttribution(code, status) {
    code = normalize(code);
    if (!CODE_RE.test(code)) return Promise.resolve({ status: "deferred", error: "invalid code syntax" });
    if (!STATUSES[status]) status = "pending";
    if (confirmedBrowser()) {
      try { console.info("[creator-codes] mock world — subscriber attributes not sent (code: " + code + ")"); } catch (e) {}
      return Promise.resolve({ status: "mock" });
    }
    var P = purchasesBridge();
    if (!P || !rcKeyValid() || typeof P.setAttributes !== "function") {
      return Promise.resolve({ status: "deferred" }); // RC not ready — a later launch retries
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        try {
          /* CAPPluginReturnNone: returns undefined — do not chain .then */
          P.setAttributes({ creator_code: code, creator_code_status: status });
          resolve({ status: "attempted" });
        } catch (e) {
          resolve({ status: "error", error: String((e && e.message) || e).slice(0, 120) });
        }
      }, ATTRIB_DELAY_MS);
    });
  }

  /* small public surface for later skills and verification */
  window.AppCreatorCodes = {
    fetchCodes: fetchCodes,
    attemptAttribution: attemptAttribution,
    saveRecord: saveRecord,
    loadRecord: loadRecord
  };

  /* ---- screen wiring (only when the creator screen exists) ---- */
  var section = $('.screen[data-screen="creator"]');
  if (section) {
    var input = $("#creator-input", section);
    var statusEl = $("#creator-status", section);

    function showStatus(text, ok) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.classList.toggle("ok", !!ok);
    }
    function liveValidate() {
      if (!input || !statusEl) return;
      var v = normalize(input.value);
      if (!v) { showStatus("", false); return; }
      if (!CODE_RE.test(v)) { showStatus("Codes are 2–24 letters, numbers, - or _", false); return; }
      if (!codesCache) { showStatus("", false); return; }
      var entry = lookup(v);
      if (entry) showStatus("Supporting " + (entry.creator || v), true);
      else showStatus("Code not recognized — you can still continue", false);
    }
    if (input) input.addEventListener("input", liveValidate);

    var prefetched = false;
    function onActive() {
      if (!section.classList.contains("active") || prefetched) return;
      prefetched = true;
      fetchCodes().then(function () { liveValidate(); });
    }
    new MutationObserver(onActive).observe(section, { attributes: true, attributeFilter: ["class"] });
    onActive();

    /* Capture phase: the SYNCHRONOUS shadow write inside saveRecord lands
       before app.js's creator-next advances the flow (no stopPropagation —
       navigation is never blocked). Apply submits a nonempty conforming
       code; Skip never submits; nonconforming input is not persisted. */
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest('[data-creator="apply"]');
      if (!btn || !input) return;
      var code = normalize(input.value);
      if (!code || !CODE_RE.test(code)) return; // empty or nonconforming: nothing to submit
      var entry = lookup(code);
      var status = entry ? "valid" : (codesCache ? "unrecognized" : "pending");
      persistRecord({ code: code, status: status, name: entry ? entry.creator : "" });
      attemptAttribution(code, status).then(function (r) { saveAttribDiag(r.status); });
    }, true);
  }

  /* ---- launch tasks: re-validate pending records, re-assert attribution ---- */
  loadRecord().then(function (rec) {
    if (!rec) return;
    var revalidated = (rec.status === "pending")
      ? fetchCodes().then(function (res) {
          if (res.status !== "ok") return rec; // still pending — a submitted code is never dropped
          var entry = lookup(rec.code);
          var next = { code: rec.code, status: entry ? "valid" : "unrecognized", name: entry ? entry.creator : "" };
          persistRecord(next);
          return next;
        })
      : Promise.resolve(rec);
    revalidated.then(function (finalRec) {
      attemptAttribution(finalRec.code, finalRec.status).then(function (r) { saveAttribDiag(r.status); });
    });
  });
})();
