// background.js — Service worker

function makeKey(company, position) {
  const c = (company || "").toLowerCase().trim();
  const p = (position || "").toLowerCase().trim();
  return `${c}||${p}`;
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function openOrUpdateTab(urlPattern, newUrl) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: urlPattern }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: newUrl, active: false });
      } else {
        chrome.tabs.create({ url: newUrl, active: false });
      }
      resolve();
    });
  });
}

// ── Open side panel when toolbar icon is clicked ──────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Allow side panel on all naukri pages ──────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.url && /naukri\.com/.test(tab.url)) {
    chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Check history + open tabs based on prefs ──────────────────────────────────────────────────
  if (message.action === "checkAndOpen") {
    const { company, position } = message;
    const bothKnown = !!(company && position);
    const key = makeKey(company, position);

    chrome.storage.local.get(["appliedJobs", "openPrefs"], (result) => {
      const appliedJobs = result.appliedJobs || {};
      const prefs = result.openPrefs || { linkedin: true, dork: true, people: true };

      if (bothKnown && appliedJobs[key]) {
        sendResponse({ alreadyApplied: true, firstSeen: formatDate(appliedJobs[key].firstSeen) });
        return;
      }

      if (bothKnown) {
        appliedJobs[key] = { company, position, firstSeen: new Date().toISOString() };
      }

      chrome.storage.local.set({ appliedJobs }, () => {
        if (prefs.linkedin) {
          const url = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(company)}&origin=GLOBAL_SEARCH_HEADER`;
          openOrUpdateTab("https://www.linkedin.com/*", url);
        }
        if (prefs.dork) {
          const dorkQuery = position
            ? `site:linkedin.com/in "${company}" "${position}"`
            : `site:linkedin.com/in "${company}"`;
          const url = `https://www.google.com/search?q=${encodeURIComponent(dorkQuery)}`;
          openOrUpdateTab("https://www.google.com/*", url);
        }
        if (prefs.people) {
          const keywords = position ? `${company} ${position}` : company;
          const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}&origin=GLOBAL_SEARCH_HEADER`;
          chrome.tabs.create({ url, active: false });
        }
        sendResponse({ alreadyApplied: false });
      });
    });
    return true;
  }

  // ── Get full history ───────────────────────────────────────────────────────
  if (message.action === "getHistory") {
    chrome.storage.local.get(["appliedJobs"], (result) => {
      const jobs = Object.values(result.appliedJobs || {});
      jobs.sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
      sendResponse({ jobs });
    });
    return true;
  }

  // ── Clear history ──────────────────────────────────────────────────────────
  if (message.action === "clearHistory") {
    chrome.storage.local.set({ appliedJobs: {} }, () => sendResponse({ ok: true }));
    return true;
  }

  // ── Delete single entry ────────────────────────────────────────────────────
  if (message.action === "deleteEntry") {
    const key = makeKey(message.company, message.position);
    chrome.storage.local.get(["appliedJobs"], (result) => {
      const appliedJobs = result.appliedJobs || {};
      delete appliedJobs[key];
      chrome.storage.local.set({ appliedJobs }, () => sendResponse({ ok: true }));
    });
    return true;
  }
});

// ── Manifest keyboard command ──────────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === "search-linkedin") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes("naukri.com")) {
        chrome.tabs.sendMessage(tab.id, { action: "triggerSearch" }, () => {
          void chrome.runtime.lastError;
        });
      }
    });
  }
});
