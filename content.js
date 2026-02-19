// content.js — Runs on all naukri.com pages
console.log("[NaukriLinkedIn] ✅ Content script loaded on:", window.location.href);

// ── Shared Helpers ───────────────────────────────────────────────────────────

function makeKey(company, position) {
  const c = (company || "").toLowerCase().trim();
  const p = (position || "").toLowerCase().trim();
  return `${c}||${p}`;
}

// ── Experience Parsing ───────────────────────────────────────────────────────

function parseMinExperience(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (t.includes("fresher") || t === "0" || t === "0 yrs" || t === "0-1 yrs") return 0;
  const rangeMatch = t.match(/^(\d+)\s*[-\u2013]\s*\d+/);
  if (rangeMatch) return parseInt(rangeMatch[1], 10);
  const plusMatch = t.match(/^(\d+)\s*\+/);
  if (plusMatch) return parseInt(plusMatch[1], 10);
  const singleMatch = t.match(/^(\d+)/);
  if (singleMatch) return parseInt(singleMatch[1], 10);
  return null;
}

function getCardMinExp(card) {
  const selectors = [
    'span.expwdth', 'span[class*="expwdth"]',
    'span[class*="exp"] span[title]',
    'span[title*=" Yrs"]', 'span[title*=" yrs"]',
    'span[title*="Year"]', 'span[title*="Fresher"]',
  ];
  for (const sel of selectors) {
    const el = card.querySelector(sel);
    if (el) {
      const minExp = parseMinExperience(el.getAttribute("title") || el.innerText || "");
      if (minExp !== null) return minExp;
    }
  }
  return null;
}

// ── Card text extraction (title + description + skills/tags) ─────────────────

function getCardSearchText(card) {
  const parts = [];

  // 1. Job title — row1 or row2 area
  const titleEl = card.querySelector(
    'a.title, .title a, [class*="title"] a, a[title], .row1 a, .row2 a'
  );
  if (titleEl) parts.push(titleEl.innerText || titleEl.getAttribute("title") || "");

  // 2. Job description — row4: span with class containing "job-desc" or "srp-description"
  const descEl = card.querySelector(
    'span[class*="job-desc"], span[class*="srp-description"], .row4 span, div.row4'
  );
  if (descEl) parts.push(descEl.innerText || "");

  // 3. Skills / tags — row5 contains the skill pills
  //    DOM: div.row5 > a or span tags with skill names separated by bullets
  const row5 = card.querySelector('.row5, div[class=" row5"]');
  if (row5) parts.push(row5.innerText || "");

  // 4. Fallback: also grab any explicit tag/skill elements anywhere in card
  card.querySelectorAll(
    '[class*="tag"], [class*="skill"], [class*="chip"], li.tag, .tags li, [class*="label"]'
  ).forEach(el => parts.push(el.innerText || ""));

  return parts.join(" ").toLowerCase();
}

// ── Card location extraction ──────────────────────────────────────────────────

function getCardLocation(card) {
  // Primary: span.locWidth has title="Bengaluru, Mumbai, New Delhi "
  const locEl = card.querySelector(
    'span.locWidth, span[class*="locWidth"], span[class*="loc"] span[title]'
  );
  if (locEl) {
    const title = locEl.getAttribute("title") || locEl.innerText || "";
    return title.toLowerCase();
  }
  // Fallback: any location-ish span
  const fallback = card.querySelector(
    '[class*="location"], [class*="loc-wrap"] span, span[title*="Remote"]'
  );
  return fallback ? (fallback.getAttribute("title") || fallback.innerText || "").toLowerCase() : "";
}

// ── Keyword matching (title + description + tags) ────────────────────────────

function cardMatchesKeywords(card, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const haystack = getCardSearchText(card);
  if (!haystack.trim()) return true; // can't determine — show it

  return keywords.some(kw => {
    const k = kw.toLowerCase().trim();
    if (!k) return false;
    try {
      // Word-boundary style: not preceded/followed by alphanumeric
      return new RegExp(
        `(?<![a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i"
      ).test(haystack);
    } catch { return haystack.includes(k); }
  });
}

// ── Location matching ────────────────────────────────────────────────────────

function cardMatchesLocation(card, locations) {
  if (!locations || locations.length === 0) return true;
  const loc = getCardLocation(card);
  if (!loc.trim()) return true; // can't determine — show it

  return locations.some(l => {
    const k = l.toLowerCase().trim();
    if (!k) return false;
    // "remote" special case
    if (k === "remote") return loc.includes("remote") || loc.includes("work from home") || loc.includes("wfh");
    try {
      return new RegExp(
        `(?<![a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i"
      ).test(loc);
    } catch { return loc.includes(k); }
  });
}

// ── State ────────────────────────────────────────────────────────────────────

let appliedJobsCache  = {};
let expFilterEnabled  = false;
let expFilterMax      = 2;
let kwFilterEnabled   = false;
let kwFilterKeywords  = [];
let locFilterEnabled  = false;
let locFilterCities   = [];
let storageReady      = false;

// ── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, type = "success", duration = 4000) {
  const existing = document.getElementById("nli-toast");
  if (existing) existing.remove();
  const colors = { success: "#0A66C2", error: "#dc2626", warning: "#b45309" };
  const icons  = { success: "🔗", error: "⚠️", warning: "🚨" };
  const toast = document.createElement("div");
  toast.id = "nli-toast";
  toast.style.cssText = `position:fixed;bottom:30px;right:30px;z-index:999999;background:${colors[type]};color:white;padding:16px 20px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.3);display:flex;align-items:flex-start;gap:10px;max-width:380px;line-height:1.5;animation:nliIn .3s ease;cursor:pointer;`;
  toast.innerHTML = `<style>@keyframes nliIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes nliOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(20px)}}</style><span style="font-size:22px;line-height:1.2">${icons[type]}</span><span>${message}</span>`;
  toast.addEventListener("click", () => toast.remove());
  document.body.appendChild(toast);
  setTimeout(() => {
    if (!toast.parentNode) return;
    toast.style.animation = "nliOut .3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Full reset ───────────────────────────────────────────────────────────────

function fullReset() {
  document.querySelectorAll(
    '[data-nli-checked],[data-nli-exp-checked],[data-nli-kw-checked],[data-nli-loc-checked]'
  ).forEach(el => {
    el.style.display = "";
    delete el.dataset.nliChecked;
    delete el.dataset.nliExpChecked;  delete el.dataset.nliExpHidden;
    delete el.dataset.nliKwChecked;   delete el.dataset.nliKwHidden;
    delete el.dataset.nliLocChecked;  delete el.dataset.nliLocHidden;
  });
}

// ── Is card hidden by application history? ───────────────────────────────────

function isHistoryHidden(card) {
  const titleEl   = card.querySelector('.title, a[title]');
  const companyEl = card.querySelector('.comp-name, .subTitle, a[title*="Careers"]');
  if (!titleEl || !companyEl) return false;
  return !!appliedJobsCache[makeKey(companyEl.innerText.trim(), titleEl.innerText.trim())];
}

// ── Should the card currently be visible? (all filters combined) ─────────────
// A card is shown only if ALL active filters pass.

function shouldShow(card) {
  return (
    !isHistoryHidden(card) &&
    !(card.dataset.nliExpHidden === "true") &&
    !(card.dataset.nliKwHidden  === "true") &&
    !(card.dataset.nliLocHidden === "true")
  );
}

function syncDisplay(card) {
  card.style.display = shouldShow(card) ? "" : "none";
}

// ── Filter: hide applied jobs ─────────────────────────────────────────────────

function hideAppliedJobs() {
  document.querySelectorAll('.srp-jobtuple-wrapper,[class*="jobTuple"]').forEach(card => {
    if (card.dataset.nliChecked === "true") return;
    card.dataset.nliChecked = "true";
    if (isHistoryHidden(card)) card.style.display = "none";
  });
}

// ── Filter: experience ────────────────────────────────────────────────────────

function applyExpFilter() {
  if (!storageReady) return;
  let hiddenCount = 0;

  document.querySelectorAll('.srp-jobtuple-wrapper,[class*="jobTuple"]').forEach(card => {
    if (isHistoryHidden(card)) return;
    if (card.dataset.nliExpChecked === "true") {
      if (card.dataset.nliExpHidden === "true") hiddenCount++;
      return;
    }
    card.dataset.nliExpChecked = "true";
    const minExp = getCardMinExp(card);
    const hide = expFilterEnabled && minExp !== null && minExp > expFilterMax;
    card.dataset.nliExpHidden = hide ? "true" : "false";
    if (hide) hiddenCount++;
    syncDisplay(card);
  });

  try { chrome.runtime.sendMessage({ action: "expFilterStatus", hiddenCount }); } catch(e) {}
}

// ── Filter: keyword ───────────────────────────────────────────────────────────

function applyKeywordFilter() {
  if (!storageReady) return;
  let hiddenCount = 0;

  document.querySelectorAll('.srp-jobtuple-wrapper,[class*="jobTuple"]').forEach(card => {
    if (isHistoryHidden(card)) return;
    if (card.dataset.nliKwChecked === "true") {
      if (card.dataset.nliKwHidden === "true") hiddenCount++;
      return;
    }
    card.dataset.nliKwChecked = "true";
    const matches = !kwFilterEnabled || cardMatchesKeywords(card, kwFilterKeywords);
    card.dataset.nliKwHidden = matches ? "false" : "true";
    if (!matches) hiddenCount++;
    syncDisplay(card);
  });

  try { chrome.runtime.sendMessage({ action: "kwFilterStatus", hiddenCount }); } catch(e) {}
}

// ── Filter: location ──────────────────────────────────────────────────────────

function applyLocationFilter() {
  if (!storageReady) return;
  let hiddenCount = 0;

  document.querySelectorAll('.srp-jobtuple-wrapper,[class*="jobTuple"]').forEach(card => {
    if (isHistoryHidden(card)) return;
    if (card.dataset.nliLocChecked === "true") {
      if (card.dataset.nliLocHidden === "true") hiddenCount++;
      return;
    }
    card.dataset.nliLocChecked = "true";
    const matches = !locFilterEnabled || cardMatchesLocation(card, locFilterCities);
    card.dataset.nliLocHidden = matches ? "false" : "true";
    if (!matches) hiddenCount++;
    syncDisplay(card);
  });

  try { chrome.runtime.sendMessage({ action: "locFilterStatus", hiddenCount }); } catch(e) {}
}

// ── Run all filters ───────────────────────────────────────────────────────────

function runAllFilters() {
  hideAppliedJobs();
  applyExpFilter();
  applyKeywordFilter();
  applyLocationFilter();
}

// ── Storage bootstrap ─────────────────────────────────────────────────────────

function loadFromStorage(callback) {
  chrome.storage.local.get(["appliedJobs", "expFilter", "kwFilter", "locFilter"], (result) => {
    appliedJobsCache = result.appliedJobs || {};

    const ef = result.expFilter || { enabled: false, maxAllowed: 2 };
    expFilterEnabled = ef.enabled;
    expFilterMax     = ef.maxAllowed;

    const kf = result.kwFilter || { enabled: false, keywords: [] };
    kwFilterEnabled  = kf.enabled;
    kwFilterKeywords = kf.keywords || [];

    const lf = result.locFilter || { enabled: false, cities: [] };
    locFilterEnabled = lf.enabled;
    locFilterCities  = lf.cities || [];

    storageReady = true;
    if (callback) callback();
  });
}

loadFromStorage(() => {
  fullReset();
  runAllFilters();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.appliedJobs) {
    appliedJobsCache = changes.appliedJobs.newValue || {};
    fullReset();
    runAllFilters();
  }
});

// ── MutationObserver (debounced) ──────────────────────────────────────────────

let _obsTimer = null;
const observer = new MutationObserver(() => {
  if (!storageReady) return;
  if (_obsTimer) return;
  _obsTimer = setTimeout(() => {
    _obsTimer = null;
    runAllFilters();
  }, 350);
});
observer.observe(document.body, { childList: true, subtree: true });

// ── Job Details extractors ────────────────────────────────────────────────────

function extractCompanyName() {
  const selectors = [
    'div[class*="styles_jd-header-comp-name"] a', '[class*="jd-header-comp-name"] a',
    'a[href*="-jobs-careers-"]', 'a[title*="Careers"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const name = el.innerText?.trim() || el.getAttribute("title")?.replace(" Careers","").trim();
      if (name) return name;
    }
  }
  return null;
}

function extractJobPosition() {
  const selectors = [
    'h1[class*="jd-header-title"]', '[class*="jd-header-title"] h1',
    '[class*="jd-header-title"]', 'h1',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) { const text = el.innerText?.trim(); if (text) return text; }
  }
  return null;
}

// ── Main action ───────────────────────────────────────────────────────────────

function openLinkedIn() {
  const company  = extractCompanyName();
  const position = extractJobPosition();
  if (!company) { showToast("No company name found. Please open a specific job listing.", "error"); return; }
  chrome.runtime.sendMessage({ action: "checkAndOpen", company, position }, (response) => {
    if (response && response.alreadyApplied) {
      showToast(`Already searched/applied!<br><b>${position||"This role"}</b> at <b>${company}</b><br><span style="font-weight:400;opacity:.9;font-size:12px">First seen: ${response.firstSeen}</span>`, "warning", 8000);
    } else {
      showToast(`Searching LinkedIn for: <b>${company}</b>`, "success");
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "L") { e.preventDefault(); openLinkedIn(); }
});

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getCompany") {
    sendResponse({ company: extractCompanyName(), position: extractJobPosition() });
  }
  if (message.action === "triggerSearch") { openLinkedIn(); }

  // Exp filter changed from side panel
  if (message.action === "expFilterChanged") {
    expFilterEnabled = message.enabled;
    expFilterMax     = message.maxAllowed;
    document.querySelectorAll('[data-nli-exp-checked]').forEach(el => {
      delete el.dataset.nliExpChecked; delete el.dataset.nliExpHidden;
      syncDisplay(el);
    });
    applyExpFilter();
  }

  // Keyword filter changed
  if (message.action === "kwFilterChanged") {
    kwFilterEnabled  = message.enabled;
    kwFilterKeywords = message.keywords || [];
    document.querySelectorAll('[data-nli-kw-checked]').forEach(el => {
      delete el.dataset.nliKwChecked; delete el.dataset.nliKwHidden;
      syncDisplay(el);
    });
    applyKeywordFilter();
  }

  // Location filter changed
  if (message.action === "locFilterChanged") {
    locFilterEnabled = message.enabled;
    locFilterCities  = message.cities || [];
    document.querySelectorAll('[data-nli-loc-checked]').forEach(el => {
      delete el.dataset.nliLocChecked; delete el.dataset.nliLocHidden;
      syncDisplay(el);
    });
    applyLocationFilter();
  }
});
