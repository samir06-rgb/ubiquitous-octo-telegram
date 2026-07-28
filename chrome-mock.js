(() => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return;

  const _store = {
    'activated': true,
    'license-key': 'TSG2026',
    'license_key': 'TSG2026',
    'license_status': 'active',
    'licensed': true,
    'is_valid': true,
    'ql_lang': 'en',
  };
  const _listeners = [];

  const noop = () => {};
  const noopPromise = () => Promise.resolve();

  const makeStorage = () => ({
    get(keys, cb) {
      let result = {};
      if (!keys) {
        result = { ..._store };
      } else if (typeof keys === 'string') {
        result = { [keys]: _store[keys] };
      } else if (Array.isArray(keys)) {
        keys.forEach(k => { result[k] = _store[k]; });
      } else if (typeof keys === 'object') {
        Object.keys(keys).forEach(k => { result[k] = k in _store ? _store[k] : keys[k]; });
      }
      if (cb) cb(result);
      return Promise.resolve(result);
    },
    set(items, cb) {
      Object.assign(_store, items);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys, cb) {
      (Array.isArray(keys) ? keys : [keys]).forEach(k => delete _store[k]);
      if (cb) cb();
      return Promise.resolve();
    },
    clear(cb) {
      Object.keys(_store).forEach(k => delete _store[k]);
      if (cb) cb();
      return Promise.resolve();
    },
    onChanged: { addListener: noop, removeListener: noop }
  });

  const makeEvent = () => ({
    addListener: noop,
    removeListener: noop,
    hasListener: () => false
  });

  const successResponse = { success: true, ok: true, status: 'ok' };

  const resolveArgs = (a, b, c, d) => {
    if (typeof a === 'function') { a(successResponse); return; }
    if (typeof b === 'function') { b(successResponse); return; }
    if (typeof c === 'function') { c(successResponse); return; }
    if (typeof d === 'function') { d(successResponse); return; }
  };

  const chromeMock = {
    storage: {
      local: makeStorage(),
      sync: makeStorage(),
      session: makeStorage(),
      onChanged: { addListener: noop, removeListener: noop }
    },
    runtime: {
      id: 'mock-extension-id',
      lastError: null,
      sendMessage(a, b, c, d) {
        resolveArgs(a, b, c, d);
        return Promise.resolve(successResponse);
      },
      onMessage: {
        addListener(fn) { _listeners.push(fn); },
        removeListener(fn) {
          const i = _listeners.indexOf(fn);
          if (i > -1) _listeners.splice(i, 1);
        }
      },
      onConnect: makeEvent(),
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      onSuspend: makeEvent(),
      getManifest: () => ({ version: '3.8.6', name: 'TSG Controller', permissions: ['storage','activeTab','scripting','tabs','sidePanel','cookies'] }),
      getURL: (path) => {
        // Redirect old icon/logo assets to the new TSG shield logo
        if (/icon\d+|gringow|logo-master|lovable-square/.test(path)) {
          return '/assets/shield-v2.png';
        }
        return '/' + path.replace(/^\//, '');
      },
      connect: () => ({
        postMessage: noop,
        name: 'mock-port',
        onMessage: { addListener: noop, removeListener: noop },
        onDisconnect: { addListener: noop, removeListener: noop },
        disconnect: noop,
      }),
      openOptionsPage: noop,
      reload: noop,
      getPlatformInfo: (cb) => cb && cb({ os: 'win', arch: 'x86-64' }),
    },
    tabs: {
      query(opts, cb) {
        const fakeTab = { id: 1, url: 'https://lovable.dev/', active: true, windowId: 1 };
        if (cb) cb([fakeTab]);
        return Promise.resolve([fakeTab]);
      },
      sendMessage(id, msg, opts, cb) {
        if (typeof opts === 'function') { opts(successResponse); }
        else if (typeof cb === 'function') { cb(successResponse); }
        return Promise.resolve(successResponse);
      },
      create(opts, cb) { const t = { id: 2, ...opts }; if (cb) cb(t); return Promise.resolve(t); },
      update(id, opts, cb) { if (cb) cb({ id, ...opts }); return Promise.resolve({ id, ...opts }); },
      get(id, cb) { const t = { id, url: 'https://lovable.dev/', active: true }; if (cb) cb(t); return Promise.resolve(t); },
      onUpdated: makeEvent(),
      onActivated: makeEvent(),
      onRemoved: makeEvent(),
    },
    windows: {
      getCurrent(opts, cb) { const w = { id: 1, focused: true }; if (cb) cb(w); return Promise.resolve(w); },
      onFocusChanged: makeEvent(),
    },
    sidePanel: {
      open: noopPromise,
      close: noopPromise,
      setOptions: noopPromise,
      getOptions: () => Promise.resolve({ path: 'sidepanel.html', enabled: true }),
    },
    cookies: {
      get: (d, cb) => { if (cb) cb(null); return Promise.resolve(null); },
      getAll: (d, cb) => { if (cb) cb([]); return Promise.resolve([]); },
      set: (d, cb) => { if (cb) cb(d); return Promise.resolve(d); },
      remove: (d, cb) => { if (cb) cb(d); return Promise.resolve(d); },
      onChanged: makeEvent(),
    },
    scripting: {
      executeScript: noopPromise,
      insertCSS: noopPromise,
      removeCSS: noopPromise,
    },
    action: {
      setBadgeText: noop,
      setBadgeBackgroundColor: noop,
      setIcon: noop,
      setTitle: noop,
      getBadgeText: (d, cb) => { if (cb) cb(''); return Promise.resolve(''); },
    },
    i18n: {
      getMessage: (key) => key,
      getUILanguage: () => 'en',
      detectLanguage: (text, cb) => cb && cb({ isReliable: true, languages: [{ language: 'en', percentage: 100 }] }),
    },
    notifications: {
      create: (id, opts, cb) => { if (cb) cb(id); return Promise.resolve(id); },
      clear: (id, cb) => { if (cb) cb(true); return Promise.resolve(true); },
      onClicked: makeEvent(),
    },
  };

  if (typeof chrome === 'undefined') {
    window.chrome = chromeMock;
  } else {
    Object.keys(chromeMock).forEach(key => {
      if (!chrome[key]) chrome[key] = chromeMock[key];
    });
  }
})();
