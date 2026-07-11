// Amnestic background: per-site snapshot/restore with global auto-reset triggers.
//
// No static host permissions or content scripts. When the user enables a site,
// the popup requests host permission for it at runtime; from then on we can use
// the cookies API for that domain and inject content.js via executeScript to
// reach its localStorage/sessionStorage.

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  onInterval: true,
  onPageLoad: false,
  onSessionStart: false,
  autoResetDays: 6,
  sites: [], // list of configured domains, e.g. ["example.com"]
};

// Domains that have had their "session start" reset this browser session.
let sessionResetDone = new Set();
browser.runtime.onStartup.addListener(() => {
  sessionResetDone = new Set();
});

// Guards so overlapping onUpdated events don't double-fire / loop.
const restoring = new Set();
const skipNextComplete = new Set();

// ---- settings + per-site storage -------------------------------------------

async function getSettings() {
  const { settings } = await browser.storage.local.get("settings");
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!Array.isArray(merged.sites)) merged.sites = [];
  return merged;
}

const siteKey = (domain) => "site:" + domain;

async function getSite(domain) {
  const key = siteKey(domain);
  const stored = await browser.storage.local.get(key);
  return stored[key] || null;
}

async function setSite(domain, record) {
  await browser.storage.local.set({ [siteKey(domain)]: record });
}

async function deleteSite(domain) {
  await browser.storage.local.remove(siteKey(domain));
}

function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

function matchDomain(host, sites) {
  return sites.find((d) => hostMatchesDomain(host, d)) || null;
}

const originPattern = (domain) => `*://*.${domain}/*`;

// ---- cookies ----------------------------------------------------------------

function cookieUrl(c) {
  const host = c.domain.replace(/^\./, "");
  return `${c.secure ? "https" : "http"}://${host}${c.path}`;
}

function serialize(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    hostOnly: c.hostOnly,
    expirationDate: c.expirationDate,
    storeId: c.storeId,
  };
}

async function setCookie(c) {
  const details = {
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    storeId: c.storeId,
  };
  if (!c.hostOnly) details.domain = c.domain;
  if (c.expirationDate) details.expirationDate = c.expirationDate;
  try {
    await browser.cookies.set(details);
  } catch (e) {
    console.warn("Failed to set cookie", c.name, e);
  }
}

async function clearCookies(domain) {
  const current = await browser.cookies.getAll({ domain });
  for (const c of current) {
    try {
      await browser.cookies.remove({
        url: cookieUrl(c),
        name: c.name,
        storeId: c.storeId,
      });
    } catch (e) {
      console.warn("Failed to remove cookie", c.name, e);
    }
  }
  return current.length;
}

// ---- page storage (injected on demand) --------------------------------------

async function injectContentScript(tabId) {
  try {
    await browser.tabs.executeScript(tabId, { file: "content.js" });
  } catch (e) {
    console.warn("Content script injection failed:", e);
    throw e;
  }
}

async function readPageStorage(tabId) {
  await injectContentScript(tabId);
  return browser.tabs.sendMessage(tabId, { type: "readStorage" });
}

async function writePageStorage(tabId, data) {
  await injectContentScript(tabId);
  return browser.tabs.sendMessage(tabId, { type: "writeStorage", data });
}

// ---- snapshot / restore -----------------------------------------------------

async function snapshot(domain, tabId) {
  const cookies = await browser.cookies.getAll({ domain });
  const storage = await readPageStorage(tabId);
  const record = {
    createdAt: Date.now(),
    lastReset: Date.now(),
    cookies: cookies.map(serialize),
    local: storage.local,
    session: storage.session,
    counts: {
      cookies: cookies.length,
      local: Object.keys(storage.local).length,
      session: Object.keys(storage.session).length,
    },
  };
  await setSite(domain, record);
  return record;
}

// reload:true forces the page to reload so the reset is visible now (manual
// button). reload:false leaves the current page alone; the next navigation
// loads clean, no flicker (auto-triggers).
async function doRestore(domain, tabId, { reload = true } = {}) {
  if (restoring.has(tabId)) return null;
  restoring.add(tabId);
  try {
    const record = await getSite(domain);
    if (!record) throw new Error("No snapshot saved for " + domain + ".");

    await clearCookies(domain);
    for (const c of record.cookies) await setCookie(c);

    try {
      await writePageStorage(tabId, { local: record.local, session: record.session });
    } catch (e) {
      console.warn("Storage write skipped:", e);
    }

    record.lastReset = Date.now();
    await setSite(domain, record);

    if (reload) {
      skipNextComplete.add(tabId);
      await browser.tabs.reload(tabId);
    }
    return record;
  } finally {
    restoring.delete(tabId);
  }
}

// ---- site management (called from popup) ------------------------------------

async function addSite(domain) {
  const settings = await getSettings();
  if (!settings.sites.includes(domain)) settings.sites.push(domain);
  await browser.storage.local.set({ settings });
  return settings;
}

async function removeSite(domain) {
  const settings = await getSettings();
  settings.sites = settings.sites.filter((d) => d !== domain);
  await browser.storage.local.set({ settings });
  await deleteSite(domain);
  try {
    await browser.permissions.remove({ origins: [originPattern(domain)] });
  } catch (e) {
    console.warn("Permission removal failed:", e);
  }
  return settings;
}

async function saveSettings(next) {
  const settings = await getSettings();
  if ("onInterval" in next) settings.onInterval = !!next.onInterval;
  if ("onPageLoad" in next) settings.onPageLoad = !!next.onPageLoad;
  if ("onSessionStart" in next) settings.onSessionStart = !!next.onSessionStart;
  if ("autoResetDays" in next) {
    settings.autoResetDays = Math.max(
      0.0001,
      Number(next.autoResetDays) || settings.autoResetDays
    );
  }
  await browser.storage.local.set({ settings });
  return settings;
}

async function status(host) {
  const settings = await getSettings();
  const matchedDomain = host ? matchDomain(host, settings.sites) : null;
  const site = matchedDomain ? await getSite(matchedDomain) : null;
  return { settings, matchedDomain, site };
}

// ---- auto-reset -------------------------------------------------------------

async function maybeAutoReset(tabId, url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }

  const settings = await getSettings();
  const domain = matchDomain(host, settings.sites);
  if (!domain) return;

  const record = await getSite(domain);
  if (!record) return;

  let should = false;
  let reason = "";
  if (settings.onPageLoad) {
    should = true;
    reason = "page-load";
  }
  if (!should && settings.onSessionStart && !sessionResetDone.has(domain)) {
    should = true;
    reason = "session-start";
  }
  if (!should && settings.onInterval) {
    const since = record.lastReset || record.createdAt || 0;
    if (Date.now() - since >= settings.autoResetDays * DAY_MS) {
      should = true;
      reason = "interval";
    }
  }

  if (should) {
    sessionResetDone.add(domain);
    console.log("Auto-reset", domain, reason);
    await doRestore(domain, tabId, { reload: false });
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab || !tab.url) return;
  if (skipNextComplete.has(tabId)) {
    skipNextComplete.delete(tabId);
    return;
  }
  maybeAutoReset(tabId, tab.url).catch((e) => console.warn("auto-reset:", e));
});

// ---- message router ---------------------------------------------------------

browser.runtime.onMessage.addListener((msg) => {
  switch (msg.cmd) {
    case "status":
      return status(msg.host);
    case "snapshot":
      return snapshot(msg.domain, msg.tabId);
    case "restore":
      return doRestore(msg.domain, msg.tabId, { reload: true });
    case "addSite":
      return addSite(msg.domain);
    case "removeSite":
      return removeSite(msg.domain);
    case "saveSettings":
      return saveSettings(msg.settings);
  }
});
