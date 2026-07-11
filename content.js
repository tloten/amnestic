// Injected on demand via tabs.executeScript (no static content_scripts, so the
// extension needs no host permissions until the user enables a site). The guard
// makes re-injection a no-op, so we never stack duplicate message listeners.
if (!window.__amnesticInjected) {
  window.__amnesticInjected = true;

  const dump = (store) => {
    const out = {};
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      out[key] = store.getItem(key);
    }
    return out;
  };

  const apply = (store, data) => {
    store.clear();
    if (!data) return;
    for (const key of Object.keys(data)) {
      try {
        store.setItem(key, data[key]);
      } catch (e) {
        // Quota or security errors on individual keys shouldn't abort the rest.
      }
    }
  };

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "readStorage") {
      return Promise.resolve({
        local: dump(window.localStorage),
        session: dump(window.sessionStorage),
      });
    }
    if (msg.type === "writeStorage") {
      apply(window.localStorage, msg.data.local);
      apply(window.sessionStorage, msg.data.session);
      return Promise.resolve({ ok: true });
    }
  });
}
