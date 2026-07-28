// ── TSG Connection Watchdog (content script) ──────────────────────────────
// Runs alongside content.js in every Lovable tab.
//
// Problem: Chrome MV3 service workers terminate after ~30s of inactivity.
//   - All chrome.runtime ports disconnect silently.
//   - content.js loses its message channel and stops working.
//   - The side panel still shows "synced" because no one told it otherwise.
//
// Fix:
//   1. Maintain a persistent open port to the SW.  An open port prevents SW
//      termination as long as the tab is active.
//   2. Ping the SW every 5s.  If the ping fails, reconnect immediately.
//   3. On reconnect, dispatch a DOM event so the existing content.js code
//      (obfuscated) can pick it up via its own event listeners if it does.
//   4. On visibility change (tab regains focus), force an immediate check.
//   5. Never give up — after the fast back-off exhausts, switch to a 10s
//      long-poll so the watchdog reconnects even without a tab focus event.

(function () {
  'use strict';

  const PING_INTERVAL_MS    =  5_000;  // ping every 5 s (was 15 s)
  const STALE_THRESHOLD_MS  = 20_000;  // dead after 20 s without pong (was 40 s)
  const RECONNECT_DELAY_MS  =    500;  // base back-off (was 1 500 ms)
  const MAX_RECONNECT_TRIES =     10;  // switch to long-poll after this many
  const LONG_RETRY_MS       = 10_000;  // long-poll interval (was 30 s)

  let port            = null;
  let pingTimer       = null;
  let lastPong        = Date.now();
  let reconnectTries  = 0;
  let reconnecting    = false;

  // ── Connect / reconnect ────────────────────────────────────────────────
  function connect() {
    if (reconnecting) return;
    reconnecting = true;

    try {
      port = chrome.runtime.connect({ name: 'tsg-watchdog' });
      lastPong       = Date.now();
      reconnectTries = 0;

      port.onMessage.addListener((msg) => {
        if (msg?.type === 'pong') lastPong = Date.now();
      });

      port.onDisconnect.addListener(() => {
        port = null;
        clearInterval(pingTimer);
        pingTimer    = null;
        reconnecting = false;
        scheduleReconnect();
      });

      startPinging();
    } catch (_) {
      reconnecting = false;
      scheduleReconnect();
    } finally {
      reconnecting = false;
    }
  }

  function scheduleReconnect() {
    reconnectTries++;
    const delay = reconnectTries > MAX_RECONNECT_TRIES
      ? LONG_RETRY_MS                                        // slow long-poll — never gives up
      : RECONNECT_DELAY_MS * Math.min(reconnectTries, 5);   // fast exponential back-off
    setTimeout(() => {
      reconnecting = false;
      connect();
    }, delay);
  }

  // ── Ping loop ──────────────────────────────────────────────────────────
  function startPinging() {
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (!port) { scheduleReconnect(); return; }

      try {
        port.postMessage({ type: 'ping', ts: Date.now() });
      } catch (_) {
        // Port died but onDisconnect hasn't fired yet
        port = null;
        clearInterval(pingTimer);
        pingTimer    = null;
        reconnecting = false;
        scheduleReconnect();
        return;
      }

      // Stale check — SW is alive but has stopped responding to pings
      if (Date.now() - lastPong > STALE_THRESHOLD_MS) {
        try { port.disconnect(); } catch (_) {}
        port = null;
        clearInterval(pingTimer);
        pingTimer    = null;
        reconnecting = false;
        scheduleReconnect();
      }
    }, PING_INTERVAL_MS);
  }

  // ── Handle SW restart broadcast ────────────────────────────────────────
  // sw-keepalive.js broadcasts 'tsg-sw-restarted' to all Lovable tabs when
  // the SW wakes up again.  Tear down the stale port and reconnect fast.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'tsg-sw-restarted') return;

    if (port) {
      try { port.disconnect(); } catch (_) {}
      port = null;
    }
    clearInterval(pingTimer);
    pingTimer      = null;
    reconnectTries = 0;
    reconnecting   = false;

    // 200 ms gives the SW time to finish initialising
    setTimeout(connect, 200);

    // Notify content.js (obfuscated) via a DOM CustomEvent so it can
    // re-register whatever listeners/long-polls it set up on first load.
    try {
      window.dispatchEvent(new CustomEvent('tsg-reconnected', { detail: { ts: Date.now() } }));
    } catch (_) {}
  });

  // ── Reconnect on tab focus ─────────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!port) {
      reconnectTries = 0;
      reconnecting   = false;
      connect();
    } else {
      // Force an immediate liveness ping
      lastPong = Date.now(); // reset grace period
      try {
        port.postMessage({ type: 'ping', ts: Date.now() });
      } catch (_) {
        port         = null;
        reconnecting = false;
        connect();
      }
    }
  });

  // ── Start ──────────────────────────────────────────────────────────────
  connect();
})();
