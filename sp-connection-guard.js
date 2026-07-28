// ── TSG Side Panel Connection Guard ───────────────────────────────────────
// The side panel shows "synced" using the last-known state from the SW.
// When the SW dies silently, the badge never updates.
//
// Strategy — two reinforcing layers:
//
//   Layer 1 — Persistent port  (tsg-sp-keepalive)
//     An open chrome.runtime port physically prevents Chrome from terminating
//     the service worker.  As long as the side panel is open the SW CANNOT
//     be killed by the 30-second idle timer.  The port carries bi-directional
//     ping/pong so we know the channel is healthy at all times.
//     On disconnect → reconnect in 300 ms; never stays down more than ~1 s.
//
//   Layer 2 — sendMessage fallback
//     If the port is mid-reconnect the periodic check falls back to a
//     one-shot sendMessage so the health check never silently skips a cycle.
//
//   Layer 3 — Network awareness
//     navigator.onLine + online/offline events give instant feedback when
//     the device loses internet, without waiting for a ping to time out.

(function () {
  'use strict';

  const PING_INTERVAL_MS = 5_000;   // check every 5 s
  const PING_TIMEOUT_MS  = 3_000;   // pong must arrive within 3 s
  const RECONNECT_AFTER  = 1;       // show warning after first failure

  let failCount      = 0;
  let patchApplied   = false;
  let networkOffline = false;

  // ── Port state ─────────────────────────────────────────────────────────
  let port        = null;
  let portBusy    = false;   // true while connect() is in flight
  let lastPong    = 0;       // timestamp of last pong received via port

  // ── UI helpers ─────────────────────────────────────────────────────────
  function findSyncEl() {
    return (
      document.querySelector('.sp-sync-ok') ||
      document.querySelector('.sp-sync-waiting') ||
      document.querySelector('.sp-sync-status')
    );
  }

  function applyDisconnectedUI() {
    if (patchApplied) return;
    patchApplied = true;
    const el = findSyncEl();
    if (el) {
      el._tsgOrigText  = el.textContent;
      el._tsgOrigColor = el.style.color;
      el.textContent   = '⚠ Reconnecting…';
      el.style.color   = '#fbbf24';
      el.style.transition = 'color 0.3s';
    }
    const card = document.querySelector('.sp-profile-card');
    if (card) card.style.opacity = '0.55';
  }

  function restoreUI() {
    if (!patchApplied) return;
    patchApplied = false;
    const el = findSyncEl();
    if (el && el._tsgOrigText !== undefined) {
      el.textContent = el._tsgOrigText;
      el.style.color = el._tsgOrigColor || '';
    }
    const card = document.querySelector('.sp-profile-card');
    if (card) card.style.opacity = '';
  }

  // ── Layer 1: Persistent port ────────────────────────────────────────────
  function openPort() {
    if (port || portBusy) return;
    portBusy = true;
    try {
      const p = chrome.runtime.connect({ name: 'tsg-sp-keepalive' });
      port     = p;
      portBusy = false;
      lastPong = Date.now();   // treat connection itself as a pong

      p.onMessage.addListener((msg) => {
        if (msg?.type === 'pong' || msg?.alive) {
          lastPong = Date.now();
          onSuccess();
        }
      });

      p.onDisconnect.addListener(() => {
        port     = null;
        portBusy = false;
        // SW terminated or crashed — tell the UI and reconnect immediately.
        onFail();
        setTimeout(openPort, 300);
      });
    } catch (_) {
      portBusy = false;
      // SW not yet available — back off and retry
      setTimeout(openPort, 1_000);
    }
  }

  // ── Layer 2: Periodic health check ─────────────────────────────────────
  function checkConnection() {
    if (networkOffline || !navigator.onLine) { onFail(); return; }

    if (port) {
      // Port is open — send a ping and rely on the onMessage handler to
      // call onSuccess().  Also check for a stale port that hasn't ponged
      // in more than two full intervals (port open but SW not responding).
      try {
        port.postMessage({ type: 'ping', ts: Date.now() });
      } catch (_) {
        port = null;
        onFail();
        openPort();
        return;
      }

      const staleMs = PING_INTERVAL_MS * 2 + PING_TIMEOUT_MS;
      if (lastPong > 0 && Date.now() - lastPong > staleMs) {
        // Port is technically open but SW is not responding to pings.
        // Force a fresh connection.
        try { port.disconnect(); } catch (_) {}
        port = null;
        onFail();
        openPort();
      }
      return;
    }

    // No port yet — sendMessage fallback
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onFail();
    }, PING_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage({ type: 'tsg-ping' }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response?.alive) {
          onFail();
        } else {
          onSuccess();
        }
      });
    } catch (_) {
      if (!settled) { settled = true; clearTimeout(timer); onFail(); }
    }

    // Make sure a port is being opened for next cycle
    openPort();
  }

  function onFail() {
    failCount++;
    if (failCount >= RECONNECT_AFTER) {
      applyDisconnectedUI();
      // Also ask the SW to re-broadcast so watchdog.js in any open
      // Lovable tabs knows to reconnect their own ports.
      try { chrome.runtime.sendMessage({ type: 'tsg-request-reconnect' }); } catch (_) {}
    }
  }

  function onSuccess() {
    failCount = 0;
    restoreUI();
  }

  // ── Layer 3: Network events ─────────────────────────────────────────────
  window.addEventListener('offline', () => { networkOffline = true;  onFail(); });
  window.addEventListener('online',  () => { networkOffline = false; checkConnection(); });

  // ── Lifecycle ──────────────────────────────────────────────────────────
  setInterval(checkConnection, PING_INTERVAL_MS);
  window.addEventListener('focus', checkConnection);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkConnection();
  });

  // Open the keep-alive port immediately; first health check after init
  openPort();
  setTimeout(checkConnection, 2_000);
})();
