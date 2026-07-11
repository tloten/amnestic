const els = {
  siteCurrent: document.getElementById("siteCurrent"),
  enableBlock: document.getElementById("enableBlock"),
  domainInput: document.getElementById("domainInput"),
  enable: document.getElementById("enable"),
  actions: document.getElementById("actions"),
  save: document.getElementById("save"),
  restore: document.getElementById("restore"),
  onInterval: document.getElementById("onInterval"),
  onPageLoad: document.getElementById("onPageLoad"),
  onSessionStart: document.getElementById("onSessionStart"),
  autoResetDays: document.getElementById("autoResetDays"),
  sitesList: document.getElementById("sitesList"),
  status: document.getElementById("status"),
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Active-tab info, resolved on load.
const active = { tabId: null, host: null, isWeb: false };

function fmtDate(ts) {
  return new Date(ts).toLocaleString();
}

function guessDomain(host) {
  return (host || "").replace(/^www\./, "");
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("err", isError);
}

function show(el, visible) {
  el.classList.toggle("hidden", !visible);
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  active.tabId = tab ? tab.id : null;
  active.host = null;
  active.isWeb = false;
  try {
    if (tab && tab.url) {
      const u = new URL(tab.url);
      active.host = u.hostname;
      active.isWeb = u.protocol === "http:" || u.protocol === "https:";
    }
  } catch {
    /* about:, etc. */
  }
}

function renderSiteSection(res) {
  if (res.matchedDomain) {
    // Configured site on the active tab.
    els.siteCurrent.textContent = `This site: ${res.matchedDomain} (enabled)`;
    show(els.enableBlock, false);
    show(els.actions, true);
  } else if (active.isWeb && active.host) {
    // A web page, but not configured yet.
    els.siteCurrent.textContent = `This site: ${active.host} (not enabled)`;
    els.domainInput.value = guessDomain(active.host);
    show(els.enableBlock, true);
    show(els.actions, false);
  } else {
    // Not a web page (about:, extension page, etc.).
    els.siteCurrent.textContent = "Open a website to enable it.";
    show(els.enableBlock, false);
    show(els.actions, false);
  }
}

function renderTriggers(settings) {
  els.onInterval.checked = settings.onInterval;
  els.onPageLoad.checked = settings.onPageLoad;
  els.onSessionStart.checked = settings.onSessionStart;
  els.autoResetDays.value = settings.autoResetDays;
  els.autoResetDays.disabled = !settings.onInterval;
}

function renderSitesList(sites) {
  els.sitesList.innerHTML = "";
  if (!sites.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "None yet.";
    els.sitesList.appendChild(li);
    return;
  }
  for (const domain of sites) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => removeSite(domain));
    li.append(span, btn);
    els.sitesList.appendChild(li);
  }
}

function renderSnapshotStatus(res) {
  if (!res.matchedDomain) {
    setStatus("");
    return;
  }
  if (!res.site) {
    setStatus("No snapshot saved yet for this site.");
    return;
  }
  const lines = [
    `Snapshot: ${res.site.counts.cookies} cookies, ` +
      `${res.site.counts.local} localStorage, ` +
      `${res.site.counts.session} sessionStorage`,
    `Last reset: ${fmtDate(res.site.lastReset || res.site.createdAt)}`,
  ];
  if (res.settings.onInterval) {
    const next =
      (res.site.lastReset || res.site.createdAt) +
      res.settings.autoResetDays * DAY_MS;
    lines.push(`Interval: next reset on visit after ${fmtDate(next)}`);
  }
  setStatus(lines.join("\n"));
}

async function refresh() {
  const res = await browser.runtime.sendMessage({ cmd: "status", host: active.host });
  renderSiteSection(res);
  renderTriggers(res.settings);
  renderSitesList(res.settings.sites);
  renderSnapshotStatus(res);
}

async function load() {
  try {
    await getActiveTab();
    await refresh();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

// ---- actions ----------------------------------------------------------------

els.enable.addEventListener("click", () => {
  const domain = els.domainInput.value.trim().replace(/^\.+|\.+$/g, "");
  if (!domain || !domain.includes(".")) {
    setStatus("Enter a valid domain, e.g. example.com", true);
    return;
  }
  // Fire the request within the user gesture, then close the popup immediately
  // so the permission prompt (anchored to the toolbar button) isn't hidden
  // behind it. The request stays alive after the popup closes, and the
  // background's permissions.onAdded listener records the site once allowed.
  browser.permissions.request({ origins: [`*://*.${domain}/*`] });
  window.close();
});

els.save.addEventListener("click", async () => {
  setStatus("Saving…");
  try {
    const res = await browser.runtime.sendMessage({ cmd: "status", host: active.host });
    await browser.runtime.sendMessage({
      cmd: "snapshot",
      domain: res.matchedDomain,
      tabId: active.tabId,
    });
    await refresh();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
});

els.restore.addEventListener("click", async () => {
  setStatus("Restoring…");
  try {
    const res = await browser.runtime.sendMessage({ cmd: "status", host: active.host });
    await browser.runtime.sendMessage({
      cmd: "restore",
      domain: res.matchedDomain,
      tabId: active.tabId,
    });
    setStatus("Restored. Reloading page…");
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
});

async function removeSite(domain) {
  try {
    await browser.runtime.sendMessage({ cmd: "removeSite", domain });
    await refresh();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

async function persistSettings() {
  try {
    await browser.runtime.sendMessage({
      cmd: "saveSettings",
      settings: {
        onInterval: els.onInterval.checked,
        onPageLoad: els.onPageLoad.checked,
        onSessionStart: els.onSessionStart.checked,
        autoResetDays: parseFloat(els.autoResetDays.value),
      },
    });
    await refresh();
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
}

for (const el of [els.onInterval, els.onPageLoad, els.onSessionStart, els.autoResetDays]) {
  el.addEventListener("change", persistSettings);
}

load();
