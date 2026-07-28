// ── TSG SW Keep-Alive ─────────────────────────────────────────────────────
// Chrome MV3 terminates service workers after ~30s of inactivity.
//
// Defence strategy — three layers:
//
//   1. Open ports prevent termination.
//      Any open chrome.runtime port keeps the SW alive indefinitely.
//      Two sources hold ports:
//        • watchdog.js   (tsg-watchdog)      — runs in every Lovable tab
//        • sp-connection-guard.js (tsg-sp-keepalive) — runs in the side panel
//      As long as the user has the side panel open, the SW CANNOT be killed.
//
//   2. Alarm-based safety net.
//      If all ports close (no Lovable tabs + side panel closed), an alarm
//      wakes the SW every minute.  On wake-up it broadcasts restart so
//      content scripts and the side panel re-establish their ports.
//
//   3. Module-evaluation broadcast.
//      Every time the SW module is evaluated (first install, update,
//      Chrome start, AND every idle-kill restart) it broadcasts
//      'tsg-sw-restarted' to all Lovable tabs via a 100 ms timeout.

(function () {
  'use strict';

  // ── Port registry ──────────────────────────────────────────────────────
  // Any registered port prevents SW termination.
  const activePorts = new Set();

  function registerPort(p) {
    activePorts.add(p);

    p.onMessage.addListener((msg) => {
      if (msg?.type !== 'ping') return;
      try {
        p.postMessage({ type: 'pong', ts: Date.now(), alive: true });
      } catch (_) { /* port already closed */ }
    });

    p.onDisconnect.addListener(() => {
      activePorts.delete(p);
    });
  }

  chrome.runtime.onConnect.addListener((p) => {
    // Accept ports from both the watchdog (content script) and the side panel
    if (p.name === 'tsg-watchdog' || p.name === 'tsg-sp-keepalive') {
      registerPort(p);
    }
  });

  // ── Message-based ping (fallback while port is reconnecting) ───────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'tsg-ping') {
      sendResponse({ type: 'tsg-pong', ts: Date.now(), alive: true });
      return true; // keep channel open for async sendResponse
    }
    if (msg?.type === 'tsg-request-reconnect') {
      _broadcastRestart();
      return false;
    }
  });

  // ── Alarm-based safety net ─────────────────────────────────────────────
  // Chrome enforces a minimum of 1 minute for alarms.  That is fine — the
  // open ports (Layer 1) handle sub-minute keep-alive during active sessions.
  // The alarm only matters when ALL ports have closed.
  chrome.alarms.create('tsg-sw-keepalive', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'tsg-sw-keepalive') return;
    // Broadcast restart so any disconnected content scripts or the side
    // panel know the SW is awake and can re-open their ports.
    _broadcastRestart();
  });

  // ── Broadcast restart to all Lovable tabs ──────────────────────────────
  async function _broadcastRestart() {
    try {
      const tabs = await chrome.tabs.query({
        url: ['https://*.lovable.dev/*', 'https://lovable.dev/*'],
      });
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'tsg-sw-restarted' });
        } catch (_) { /* tab may not have content script yet */ }
      }
    } catch (_) { /* tabs permission guard */ }
  }

  // Fire on named lifecycle events
  chrome.runtime.onStartup.addListener(_broadcastRestart);
  chrome.runtime.onInstalled.addListener(_broadcastRestart);

  // ── Fire on every SW wake-up (Layer 3) ────────────────────────────────
  // onStartup / onInstalled do NOT fire when Chrome kills an idle SW and
  // then wakes it via an alarm or incoming message.  This setTimeout runs
  // every single time the SW module is evaluated — covering all wake-ups.
  setTimeout(_broadcastRestart, 100);
})();
