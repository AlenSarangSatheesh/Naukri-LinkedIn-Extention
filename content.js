// content.js — Runs on all naukri.com pages
console.log("[NaukriLinkedIn] ✅ Content script loaded on:", window.location.href);

// ── Extension context safety ──────────────────────────────────────────────────
// After an extension update/reload, all chrome.* calls throw "context invalidated".
// Every chrome API call goes through these wrappers so the page never crashes.

function ctxOk() {
  try { return !!chrome.runtime?.id; } catch (e) { return false; }
}

const safeStorage = {
  get: (keys, cb) => {
    if (!ctxOk()) return;
    try { chrome.storage.local.get(keys, cb); } catch (e) { /* silent */ }
  },
  set: (obj, cb) => {
    if (!ctxOk()) return;
    try { chrome.storage.local.set(obj, cb); } catch (e) { /* silent */ }
  },
};

function safeMsg(msg, cb) {
  if (!ctxOk()) return;
  try {
    chrome.runtime.sendMessage(msg, cb || (() => { void chrome.runtime.lastError; }));
  } catch (e) { /* context gone — silently ignore */ }
}

// ── Shared Helpers ───────────────────────────────────────────────────────────

// Single selector for ALL job card types (regular + promoted/sponsored)
const CARD_SELECTOR = '.srp-jobtuple-wrapper, [class*="jobTuple"], .srp-tuple, .cust-job-tuple';

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
  const rangeMatch = t.match(/(\d+)\s*[-–—]\s*\d+\s*(?:yr|year)/i);
  if (rangeMatch) return parseInt(rangeMatch[1], 10);
  const plusMatch = t.match(/(\d+)\s*\+\s*(?:yr|year)?/i);
  if (plusMatch) return parseInt(plusMatch[1], 10);
  const singleMatch = t.match(/(\d+)\s*(?:yr|year)/i);
  if (singleMatch) return parseInt(singleMatch[1], 10);
  const numMatch = t.match(/^(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  return null;
}

function getCardMinExp(card) {
  const selectors = [
    'span.expwdth', 'span[class*="expwdth"]',
    'span[class*="exp"] span[title]',
    'span[title*=" Yrs"]', 'span[title*=" yrs"]',
    'span[title*="Year"]', 'span[title*="Fresher"]',
    'span[class*="experience"]', '[class*="experience"]',
    'span[class*="exp-wrap"]', '[class*="exp-wrap"]',
  ];
  for (const sel of selectors) {
    const el = card.querySelector(sel);
    if (el) {
      const minExp = parseMinExperience(el.getAttribute("title") || el.innerText || "");
      if (minExp !== null) return minExp;
    }
  }
  const candidates = card.querySelectorAll('span, li, div.row2, div.row3');
  for (const el of candidates) {
    const txt = (el.getAttribute("title") || el.innerText || "").trim();
    if (/\d+\s*[-–—+]?\s*\d*\s*(?:yr|year)/i.test(txt) || /fresher/i.test(txt)) {
      const minExp = parseMinExperience(txt);
      if (minExp !== null) return minExp;
    }
  }
  const fullText = card.innerText || "";
  const expPattern = fullText.match(/(\d+\s*[-–—]\s*\d+\s*(?:Yrs?|Years?))/i)
    || fullText.match(/(\d+\s*\+?\s*(?:Yrs?|Years?))/i);
  if (expPattern) {
    const minExp = parseMinExperience(expPattern[1]);
    if (minExp !== null) return minExp;
  }
  return null;
}

// ── Card text extraction ──────────────────────────────────────────────────────

function getCardSearchText(card) {
  const parts = [];
  const titleEl = card.querySelector('a.title, .title a, [class*="title"] a, a[title], .row1 a, .row2 a');
  if (titleEl) parts.push(titleEl.innerText || titleEl.getAttribute("title") || "");
  const descEl = card.querySelector('span[class*="job-desc"], span[class*="srp-description"], .row4 span, div.row4');
  if (descEl) parts.push(descEl.innerText || "");
  const row5 = card.querySelector('.row5, div[class=" row5"]');
  if (row5) parts.push(row5.innerText || "");
  card.querySelectorAll('[class*="tag"], [class*="skill"], [class*="chip"], li.tag, .tags li, [class*="label"]').forEach(el => parts.push(el.innerText || ""));
  return parts.join(" ").toLowerCase();
}

function getCardLocation(card) {
  const locEl = card.querySelector('span.locWidth, span[class*="locWidth"], span[class*="loc"] span[title]');
  if (locEl) return (locEl.getAttribute("title") || locEl.innerText || "").toLowerCase();
  const fallback = card.querySelector('[class*="location"], [class*="loc-wrap"] span, span[title*="Remote"]');
  return fallback ? (fallback.getAttribute("title") || fallback.innerText || "").toLowerCase() : "";
}

// ── Page type detection ───────────────────────────────────────────────────────

function isSearchResultsPage() {
  const url = window.location.href.toLowerCase();
  return url.includes("naukri.com") && (
    url.includes("-jobs") ||
    url.includes("search-") ||
    url.includes("q=") ||
    url.includes("/jobs-") ||
    /[?&]k=/.test(url)
  );
}

function isJobDetailPage() {
  const url = window.location.href.toLowerCase();
  return url.includes("naukri.com") && (
    url.includes("-jd-") ||
    url.includes("/job-listings-") ||
    url.includes("/jobdetail") ||
    (/sid=/.test(url) && !/[?&]k=/.test(url))
  );
}

// ── Pagination Helper ──────────────────────────────────────────────────────────

function findNextPageButton() {
  const specialized = [
    'a.styles_btn-next__zms_i', // Modern v3
    'a[class*="styles_btn-next"]',
    'a[class*="btn-next"]',
    'a.next-btn',
    'a[rel="next"]',
    '.pagination-container .next',
    '.pagination .next',
    'a.styles_btn-next',
    '.styles_btn-next'
  ];
  for (const sel of specialized) {
    const btn = document.querySelector(sel);
    if (btn && !btn.classList.contains('disabled')) return btn;
  }

  // Deep search in pagination components
  const pagContainers = document.querySelectorAll('.pagination, [class*="pagination"], .styles_pages');
  for (const pag of pagContainers) {
    const links = pag.querySelectorAll('a, button');
    for (const a of links) {
      const txt = a.innerText.toLowerCase();
      // Match "Next", "Next >", ">", etc.
      if (txt.includes("next") || txt === ">" || txt.includes("»") || a.querySelector('[class*="next"]') || a.querySelector('[class*="icon-next"]')) {
        const isSelfDisabled = a.classList.contains('disabled') || a.hasAttribute('disabled');
        const isParentDisabled = a.parentElement?.classList.contains('disabled');
        if (!isSelfDisabled && !isParentDisabled) return a;
      }
    }
  }
  return null;
}

// ── Meta extraction for Detail Page ──────────────────────────────────────────

function extractCompanyName() {
  const selectors = [
    'div[class*="styles_jd-header-comp-name"] a',
    '[class*="jd-header-comp-name"] a',
    'a[href*="-jobs-careers-"]',
    'a[title*="Careers"]',
    '.companyName'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return (el.innerText?.trim() || el.getAttribute("title")?.replace(" Careers", "").trim());
  }
  return null;
}

function extractJobPosition() {
  const selectors = [
    'h1[class*="styles_jd-header-title"]',
    'h1[class*="jd-header-title"]',
    '[class*="jd-header-title"] h1',
    '[class*="jd-header-title"]',
    'h1'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el.innerText?.trim();
  }
  return null;
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

// ── Keyword exclude matching ──────────────────────────────────────────────────

function cardMatchesExcludeKeywords(card, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const haystack = getCardSearchText(card);
  if (!haystack.trim()) return false;

  return keywords.some(kw => {
    const k = kw.toLowerCase().trim();
    if (!k) return false;
    // Substring match for exclusions — if "tele" is in "telecalling", hide it.
    return haystack.includes(k);
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

let appliedJobsCache = {};
let ignoredJobsCache = {};
let expFilterEnabled = false;
let expFilterMax = 2;
let kwFilterEnabled = false;
let kwFilterKeywords = [];
let kwExcludeEnabled = false;
let kwExcludeKeywords = [];
let locFilterEnabled = false;
let locFilterCities = [];
let storageReady = false;

// ── Auto-Skip state ───────────────────────────────────────────────────────────
let autoSkipEnabled = false;
let autoSkipTimer = null;
let foundJobsAlerted = false; // Tracks if we've already chimed on this page

// ── Toast & Audio ─────────────────────────────────────────────────────────────

function showToast(message, type = "success", duration = 4000) {
  const existing = document.getElementById("nli-toast");
  if (existing) existing.remove();
  const colors = { success: "#0A66C2", error: "#dc2626", warning: "#b45309" };
  const icons = { success: "🔗", error: "⚠️", warning: "🚨" };
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

// Synthesizes a pleasant notification chime directly in the browser
function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Creates a double-tone "ding" sound
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.log("[NaukriLinkedIn] 🔇 Could not play sound:", e);
  }
}

// ── Full reset ───────────────────────────────────────────────────────────────

function fullReset() {
  document.querySelectorAll(
    '[data-nli-checked],[data-nli-exp-checked],[data-nli-kw-checked],[data-nli-loc-checked]'
  ).forEach(el => {
    el.style.display = "";
    delete el.dataset.nliChecked;
    delete el.dataset.nliExpChecked; delete el.dataset.nliExpHidden;
    delete el.dataset.nliKwChecked; delete el.dataset.nliKwHidden;
    delete el.dataset.nliLocChecked; delete el.dataset.nliLocHidden;
  });
}

// ── Is card permanently ignored by user? ─────────────────────────────────────

function getCardKey(card) {
  const titleEl = card.querySelector('a.title, .title a, [class*="title"] a, a[title], .row1 a, .row2 a');
  const companyEl = card.querySelector('.comp-name, .subTitle, a[title*="Careers"]');
  const title = titleEl ? (titleEl.innerText || titleEl.getAttribute("title") || "").trim() : "";
  const company = companyEl ? companyEl.innerText.trim() : "";
  return makeKey(company, title);
}

function isIgnored(card) {
  const key = getCardKey(card);
  return !!key && !!ignoredJobsCache[key];
}

// ── Inject "Not Interested" button on each card ───────────────────────────────

function injectHideButtons() {
  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
    if (card.dataset.nliHideBtnInjected) return;
    // Skip nested matches — only inject on the outermost card element
    if (card.parentElement && card.parentElement.closest(CARD_SELECTOR)) return;
    card.dataset.nliHideBtnInjected = "true";

    // Make card position:relative so button can be absolute
    const pos = window.getComputedStyle(card).position;
    if (pos === "static") card.style.position = "relative";

    const btn = document.createElement("button");
    btn.className = "nli-ignore-btn";
    btn.title = "Not interested — hide permanently";
    btn.innerHTML = "👎 Not Interested";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      ignoreCard(card, btn);
    });
    card.appendChild(btn);
  });
}

function ignoreCard(card, btn) {
  const titleEl = card.querySelector('a.title, .title a, [class*="title"] a, a[title], .row1 a, .row2 a');
  const companyEl = card.querySelector('.comp-name, .subTitle, a[title*="Careers"]');
  const title = titleEl ? (titleEl.innerText || titleEl.getAttribute("title") || "").trim() : "Unknown";
  const company = companyEl ? companyEl.innerText.trim() : "Unknown";
  const key = makeKey(company, title);
  if (!key || key === "||") return;

  const entry = { company, title, hiddenAt: new Date().toISOString() };
  ignoredJobsCache[key] = entry;

  safeStorage.set({ ignoredJobs: ignoredJobsCache }, () => {
    card.style.display = "none";
    showToast(`👎 Hidden: <b>${title}</b><br><span style="font-weight:400;font-size:12px">at ${company} — won't show again</span>`, "warning", 4000);
    safeMsg({ action: "ignoredJobsUpdated" });
  });
}

// Inject CSS for the button
(function injectIgnoreStyle() {
  if (document.getElementById("nli-ignore-style")) return;
  const style = document.createElement("style");
  style.id = "nli-ignore-style";
  style.textContent = `
    .nli-ignore-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 9999;
      background: #fff;
      color: #6b7280;
      border: 1.5px solid #e5e7eb;
      border-radius: 20px;
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      display: none;
      align-items: center;
      gap: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,.08);
      transition: all .15s;
      white-space: nowrap;
    }
    .nli-ignore-btn:hover {
      background: #fef2f2;
      border-color: #fca5a5;
      color: #dc2626;
      box-shadow: 0 3px 10px rgba(220,38,38,.15);
    }
    .srp-jobtuple-wrapper:hover .nli-ignore-btn,
    [class*="jobTuple"]:hover .nli-ignore-btn,
    .srp-tuple:hover .nli-ignore-btn,
    .cust-job-tuple:hover .nli-ignore-btn {
      display: inline-flex;
    }
  `;
  document.head.appendChild(style);
})();

// ── "Not Interested" button on JOB DETAIL page ───────────────────────────────

function injectDetailPageButton() {
  if (!isJobDetailPage()) return;
  if (document.getElementById("nli-detail-ignore-btn")) return;

  // Find the exact container that holds the "Save" and "Apply" buttons
  const allButtons = Array.from(document.querySelectorAll('button'));
  const saveBtn = allButtons.find(b => b.innerText && b.innerText.trim() === 'Save');
  const applyBtn = document.getElementById('apply-button') || allButtons.find(b => b.innerText && b.innerText.trim() === 'Apply');

  let targetContainer = null;
  if (saveBtn) targetContainer = saveBtn.parentElement;
  else if (applyBtn) targetContainer = applyBtn.parentElement;
  else {
    // Fallback if buttons haven't loaded yet
    const fallbackSelectors = [
      '[class*="styles_jhc__btn-container"]',
      '[class*="styles_buttons"]',
      '[class*="jd-header-content"]',
    ];
    for (const sel of fallbackSelectors) {
      targetContainer = document.querySelector(sel);
      if (targetContainer) break;
    }
  }

  if (!targetContainer) return;

  const company = extractCompanyName();
  const position = extractJobPosition();
  if (!company || !position) return;

  const key = makeKey(company, position);
  const alreadyIgnored = !!ignoredJobsCache[key];

  const btn = document.createElement("button");
  btn.id = "nli-detail-ignore-btn";
  btn.innerHTML = alreadyIgnored ? "✅ Restored" : "👎 Not Interested";

  // Styling to match Naukri's native rounded "Save" button
  btn.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    margin-right: 12px;
    padding: 0 20px;
    height: 45px;
    background: ${alreadyIgnored ? "#f0fdf4" : "#fff"};
    color: ${alreadyIgnored ? "#16a34a" : "#dc2626"};
    border: 1px solid ${alreadyIgnored ? "#86efac" : "#dc2626"};
    border-radius: 94px; /* matches naukri pill shape */
    font-size: 14px; font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: all .15s;
  `;

  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.ignored === "true") return;
    btn.style.background = "#fff1f2";
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.dataset.ignored === "true") return;
    btn.style.background = "#fff";
  });

  btn.addEventListener("click", () => {
    if (btn.dataset.ignored === "true") {
      // Restore
      delete ignoredJobsCache[key];
      safeStorage.set({ ignoredJobs: ignoredJobsCache }, () => {
        btn.dataset.ignored = "false";
        btn.innerHTML = "👎 Not Interested";
        btn.style.background = "#fff";
        btn.style.borderColor = "#dc2626";
        btn.style.color = "#dc2626";
        showToast(`↩ Restored: <b>${position}</b> at <b>${company}</b>`, "success", 3000);
        safeMsg({ action: "ignoredJobsUpdated" });
      });
    } else {
      // Ignore
      ignoredJobsCache[key] = { company, title: position, hiddenAt: new Date().toISOString() };
      safeStorage.set({ ignoredJobs: ignoredJobsCache }, () => {
        btn.dataset.ignored = "true";
        btn.innerHTML = "✅ Restored";
        btn.style.background = "#f0fdf4";
        btn.style.borderColor = "#86efac";
        btn.style.color = "#16a34a";
        showToast(`👎 Hidden: <b>${position}</b><br><span style="font-weight:400;font-size:12px">at ${company} — won't show again in listings</span>`, "warning", 4000);
        safeMsg({ action: "ignoredJobsUpdated" });
      });
    }
  });

  btn.dataset.ignored = alreadyIgnored ? "true" : "false";

  // Insert before the Save button if it exists, otherwise prepend to the container
  if (saveBtn && targetContainer === saveBtn.parentElement) {
    targetContainer.insertBefore(btn, saveBtn);
  } else {
    targetContainer.prepend(btn);
  }
}

// ── Is card hidden by application history? ───────────────────────────────────

function isHistoryHidden(card) {
  const titleEl = card.querySelector('.title, a[title]');
  const companyEl = card.querySelector('.comp-name, .subTitle, a[title*="Careers"]');
  if (!titleEl || !companyEl) return false;
  return !!appliedJobsCache[makeKey(companyEl.innerText.trim(), titleEl.innerText.trim())];
}

// ── Should the card currently be visible? (all filters combined) ─────────────
// A card is shown only if ALL active filters pass.

function shouldShow(card) {
  return (
    !isHistoryHidden(card) &&
    !isIgnored(card) &&
    !(card.dataset.nliExpHidden === "true") &&
    !(card.dataset.nliKwHidden === "true") &&
    !(card.dataset.nliLocHidden === "true")
  );
}

function syncDisplay(card) {
  card.style.display = shouldShow(card) ? "" : "none";
}

// ── Filter: hide applied jobs ─────────────────────────────────────────────────

function hideAppliedJobs() {
  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
    if (card.dataset.nliChecked === "true") return;
    card.dataset.nliChecked = "true";
    if (isHistoryHidden(card)) card.style.display = "none";
  });
}

// ── Filter: experience ────────────────────────────────────────────────────────

function applyExpFilter() {
  if (!storageReady) return;
  let hiddenCount = 0;

  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
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

  safeMsg({ action: "expFilterStatus", hiddenCount });
}

// ── Filter: keyword ───────────────────────────────────────────────────────────

function applyKeywordFilter() {
  if (!storageReady) return;
  let hiddenIncludeCount = 0;
  let hiddenExcludeCount = 0;

  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
    if (isHistoryHidden(card)) return;
    if (card.dataset.nliKwChecked === "true") {
      if (card.dataset.nliKwHidden === "true") {
        // We need to re-evaluate to know WHY it was hidden for counts
        const includeMatches = !kwFilterEnabled || cardMatchesKeywords(card, kwFilterKeywords);
        const excludeMatches = kwExcludeEnabled && cardMatchesExcludeKeywords(card, kwExcludeKeywords);
        if (!includeMatches) hiddenIncludeCount++;
        else if (excludeMatches) hiddenExcludeCount++;
      }
      return;
    }
    card.dataset.nliKwChecked = "true";
    const includeMatches = !kwFilterEnabled || cardMatchesKeywords(card, kwFilterKeywords);
    const excludeMatches = kwExcludeEnabled && cardMatchesExcludeKeywords(card, kwExcludeKeywords);
    const hide = !includeMatches || excludeMatches;

    if (!includeMatches) hiddenIncludeCount++;
    else if (excludeMatches) hiddenExcludeCount++;

    card.dataset.nliKwHidden = hide ? "true" : "false";
    syncDisplay(card);
  });

  safeMsg({ action: "kwFilterStatus", hiddenCount: hiddenIncludeCount });
  safeMsg({ action: "kwExcludeFilterStatus", hiddenCount: hiddenExcludeCount });
}

// ── Filter: location ──────────────────────────────────────────────────────────

function applyLocationFilter() {
  if (!storageReady) return;
  let hiddenCount = 0;

  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
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

  safeMsg({ action: "locFilterStatus", hiddenCount });
}

// ── Run all filters ───────────────────────────────────────────────────────────

function runAllFilters() {
  hideAppliedJobs();
  applyExpFilter();
  applyKeywordFilter();
  applyLocationFilter();
}

// ── Deep Scanner logic ────────────────────────────────────────────────────────

let lastScannedUrl = "";
let scannerRetries = 0;

function runScanner() {
  if (!scannerActive || !storageReady || isJobDetailPage()) return;
  if (scannerTimer) clearTimeout(scannerTimer);

  const currentUrl = window.location.href;
  if (currentUrl === lastScannedUrl && scannerPagesScanned > 0) {
    // We already scanned this exact page (likely page load hasn't finished navigating yet)
    scannerTimer = setTimeout(runScanner, 2000);
    return;
  }

  // Give filters and content a moment to settle
  scannerTimer = setTimeout(() => {
    scannerTimer = null;
    if (!scannerActive) return;

    const cards = document.querySelectorAll(CARD_SELECTOR);

    // If no cards found, maybe they are still loading? 
    // Naukri uses skeleton loaders. Let's check for them or wait.
    if (cards.length === 0) {
      if (scannerRetries < 5) {
        scannerRetries++;
        showToast(`⏳ Page empty? Retrying... (${scannerRetries}/5)`, "warning", 1000);
        scannerTimer = setTimeout(runScanner, 3000);
        return;
      } else {
        showToast("⚠️ No jobs found on this page. Stopping scanner.", "error", 5000);
        scannerActive = false;
        safeStorage.set({ scannerActive: false });
        return;
      }
    }

    scannerRetries = 0;
    lastScannedUrl = currentUrl;
    const currentMatches = [];

    cards.forEach(card => {
      if (shouldShow(card)) {
        const titleEl = card.querySelector('a.title, .title a, [class*="title"] a, a[title], .row1 a, .row2 a');
        const companyEl = card.querySelector('.comp-name, .subTitle, a[title*="Careers"]');

        const title = titleEl ? (titleEl.innerText || titleEl.getAttribute("title") || "").trim() : "Unknown";
        const company = companyEl ? companyEl.innerText.trim() : "Unknown";
        const url = titleEl ? titleEl.href : "";
        const location = getCardLocation(card);
        const exp = getCardMinExp(card);
        const key = makeKey(company, title);

        if (key && key !== "||" && !scannerMatches[key]) {
          const match = {
            title,
            company,
            url,
            location,
            exp: exp !== null ? `${exp} Yrs` : "Not disclosed",
            scrapedAt: new Date().toISOString()
          };
          scannerMatches[key] = match;
          currentMatches.push(match);
        }
      }
    });

    scannerPagesScanned++;
    scannerTotalMatches = Object.keys(scannerMatches).length;

    // Safe merge with storage to prevent accidental resets
    chrome.storage.local.get(["scannedMatches", "scannerStats"], (res) => {
      const globalMatches = res.scannedMatches || {};
      const globalStats = res.scannerStats || { pages: 0, matches: 0 };

      // Ensure we haven't 'lost' our memory state compared to storage
      const mergedMatches = { ...globalMatches, ...scannerMatches };

      // Update variables to reflect true state
      scannerMatches = mergedMatches;
      scannerTotalMatches = Object.keys(mergedMatches).length;

      // If our current page count is suspiciously low (like 1), but storage had more,
      // something probably reset our memory. We should trust storage's page count if it was higher.
      const finalPages = Math.max(scannerPagesScanned, globalStats.pages);
      scannerPagesScanned = finalPages;

      safeStorage.set({
        scannedMatches: mergedMatches,
        scannerStats: { pages: finalPages, matches: scannerTotalMatches }
      }, () => {
        safeMsg({
          action: "scannerProgress",
          pages: finalPages,
          matches: scannerTotalMatches,
          newMatches: currentMatches.length
        });

        const nextBtn = findNextPageButton();
        if (nextBtn) {
          showToast(`🔍 Scanned page <b>${finalPages}</b>. Found <b>${currentMatches.length}</b> new matches.<br>Moving to next page...`, "success", 1500);
          setTimeout(() => {
            if (scannerActive) {
              try { nextBtn.click(); } catch (e) { if (nextBtn.href) window.location.href = nextBtn.href; }
            }
          }, 2000);
        } else {
          scannerActive = false;
          safeStorage.set({ scannerActive: false });
          showToast(`🏁 <b>Scan Complete!</b> Scanned <b>${finalPages}</b> pages and found <b>${scannerTotalMatches}</b> matching jobs.`, "success", 8000);
          safeMsg({ action: "scannerComplete", pages: finalPages, matches: scannerTotalMatches });
        }
      });
    });
  }, 3500);
}

// ── Storage bootstrap ─────────────────────────────────────────────────────────

function loadFromStorage(callback) {
  safeStorage.get(["appliedJobs", "ignoredJobs", "expFilter", "kwFilter", "kwExcludeFilter", "locFilter", "autoSkip"], (result) => {
    appliedJobsCache = result.appliedJobs || {};
    ignoredJobsCache = result.ignoredJobs || {};

    const ef = result.expFilter || { enabled: false, maxAllowed: 2 };
    expFilterEnabled = ef.enabled;
    expFilterMax = ef.maxAllowed;

    const kf = result.kwFilter || { enabled: false, keywords: [] };
    kwFilterEnabled = kf.enabled;
    kwFilterKeywords = kf.keywords || [];

    const kxf = result.kwExcludeFilter || { enabled: false, keywords: [] };
    kwExcludeEnabled = kxf.enabled;
    kwExcludeKeywords = kxf.keywords || [];

    const lf = result.locFilter || { enabled: false, cities: [] };
    locFilterEnabled = lf.enabled;
    locFilterCities = lf.cities || [];

    const as = result.autoSkip || { enabled: false };
    autoSkipEnabled = as.enabled;

    storageReady = true;
    if (callback) callback();
  });
}

function countVisibleCards() {
  let count = 0;
  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
    if (card.style.display !== "none") count++;
  });
  return count;
}

function checkAutoSkip() {
  if (!autoSkipEnabled || !storageReady || isJobDetailPage()) return;

  if (autoSkipTimer) return;

  autoSkipTimer = setTimeout(() => {
    autoSkipTimer = null;
    if (!autoSkipEnabled) return;

    const visible = countVisibleCards();
    const allCards = document.querySelectorAll(CARD_SELECTOR);
    const isLoading = !!document.querySelector('.srp-loader, .skeleton, .styles_skeleton, [class*="skeleton"], [class*="loading"]');

    console.log(`[NaukriLinkedIn] ⏭ Auto-Skip check: visible=${visible}, total=${allCards.length}, loading=${isLoading}`);

    if (visible === 0 && allCards.length > 0) {
      if (isLoading) {
        console.log("[NaukriLinkedIn] ⏳ Page still loading cards, waiting...");
        return;
      }

      const nextBtn = findNextPageButton();
      if (!nextBtn) {
        console.log("[NaukriLinkedIn] 🏁 No Next button found — reached end or pagination not ready.");
        return;
      }

      console.log("[NaukriLinkedIn] ⏭ Every job is filtered out. Triggering Auto-Skip...");

      safeStorage.get(["autoSkipCount"], (r) => {
        const newCount = (r.autoSkipCount || 0) + 1;
        safeStorage.set({ autoSkipCount: newCount }, () => {
          showToast(`⏭ Auto-skipping filtered page (${newCount} skipped)`, "warning", 1500);
          setTimeout(() => {
            try {
              console.log("[NaukriLinkedIn] 🚀 Clicking Next button:", nextBtn);
              if (typeof nextBtn.click === 'function') nextBtn.click();
              else if (nextBtn.href) window.location.href = nextBtn.href;
            } catch (e) {
              if (nextBtn.href) window.location.href = nextBtn.href;
            }
          }, 150);
        });
      });
    } else if (allCards.length === 0) {
      // Natural empty page
      if (isLoading) return;
      const nextBtn = findNextPageButton();
      if (!nextBtn) return;

      console.log("[NaukriLinkedIn] ⏭ Page is naturally empty. Auto-skipping...");
      safeStorage.get(["autoSkipCount"], (r) => {
        const newCount = (r.autoSkipCount || 0) + 1;
        safeStorage.set({ autoSkipCount: newCount }, () => {
          showToast(`⏭ Auto-skipping empty page (${newCount} skipped)`, "warning", 1500);
          setTimeout(() => { try { nextBtn.click(); } catch (e) { if (nextBtn.href) window.location.href = nextBtn.href; } }, 150);
        });
      });
    } else if (visible > 0) {
      // We found jobs! Stop skipping and alert the user.
      if (isLoading) return;

      if (!foundJobsAlerted) {
        console.log("[NaukriLinkedIn] 🔔 Jobs found! Playing alert sound.");
        playNotificationSound();
        foundJobsAlerted = true;
        showToast("🔔 <b>Jobs Found!</b><br>Auto-skip paused for your review.", "success", 6000);
      }
    }
  }, 800);
}

// ── SPA Navigation Observer ──────────────────────────────────────────────────

let lastKnownUrl = window.location.href;
function checkUrlChange() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastKnownUrl) {
    console.log("[NaukriLinkedIn] 📍 URL Change detected (SPA):", currentUrl);
    lastKnownUrl = currentUrl;

    // Reset the audio alert tracker so it can chime on the new page
    foundJobsAlerted = false;

    runAllFilters();
    injectHideButtons();
    injectDetailPageButton(); // Always try to inject on page change

    chrome.storage.local.get(["scannerActive"], (r) => {
      checkAutoSkip();
    });
  }
}
window.addEventListener('popstate', checkUrlChange);
window.addEventListener('hashchange', checkUrlChange);
setInterval(checkUrlChange, 1500);

loadFromStorage(() => {
  lastKnownUrl = window.location.href;
  fullReset();
  runAllFilters();
  injectHideButtons();
  injectDetailPageButton();
  checkAutoSkip();
});

if (ctxOk()) {
  chrome.storage.onChanged.addListener((changes) => {
    if (!ctxOk()) return;
    if (changes.appliedJobs) {
      appliedJobsCache = changes.appliedJobs.newValue || {};
      fullReset();
      runAllFilters();
      checkAutoSkip();
    }
    if (changes.ignoredJobs) {
      ignoredJobsCache = changes.ignoredJobs.newValue || {};
      fullReset();
      runAllFilters();
      checkAutoSkip();
    }
  });
}

const observer = new MutationObserver((mutations) => {
  if (!storageReady) return;

  // Check if any added nodes are job cards to trigger filter run
  const hasNewCards = mutations.some(m =>
    Array.from(m.addedNodes).some(node => node.nodeType === 1 && (node.matches?.(CARD_SELECTOR) || node.querySelector?.(CARD_SELECTOR)))
  );

  if (hasNewCards) runAllFilters();

  injectHideButtons();
  injectDetailPageButton(); // Catch delayed loads on detail pages
  checkAutoSkip();
});
observer.observe(document.body, { childList: true, subtree: true });
// ── Main action ───────────────────────────────────────────────────────────────

function openLinkedIn() {
  const company = extractCompanyName();
  const position = extractJobPosition();
  if (!company) { showToast("No company name found. Please open a specific job listing.", "error"); return; }
  const url = window.location.href;
  safeMsg({ action: "checkAndOpen", company, position, url }, (response) => {
    if (response && response.alreadyApplied) {
      showToast(`Already searched/applied!<br><b>${position || "This role"}</b> at <b>${company}</b><br><span style="font-weight:400;opacity:.9;font-size:12px">First seen: ${response.firstSeen}</span>`, "warning", 8000);
    } else {
      showToast(`Searching LinkedIn for: <b>${company}</b>`, "success");
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "L") { e.preventDefault(); openLinkedIn(); }
});

// ── Messages ──────────────────────────────────────────────────────────────────

if (ctxOk()) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!ctxOk()) return;
    if (message.action === "getCompany") {
      sendResponse({ company: extractCompanyName(), position: extractJobPosition() });
    }
    if (message.action === "triggerSearch") { openLinkedIn(); }

    // Side panel requests list of hidden jobs
    if (message.action === "getHiddenJobs") {
      const hiddenJobs = [];
      document.querySelectorAll(CARD_SELECTOR).forEach(card => {
        if (card.style.display !== "none") return;

        const titleEl = card.querySelector('a.title, .title a, [class*="title"] a, a[title], .row1 a, .row2 a');
        const companyEl = card.querySelector('.comp-name, .subTitle, a[title*="Careers"]');
        const title = titleEl ? (titleEl.innerText || titleEl.getAttribute("title") || "").trim() : "Unknown";
        const company = companyEl ? companyEl.innerText.trim() : "Unknown";

        const reasons = [];
        if (isHistoryHidden(card)) reasons.push("Applied");
        if (isIgnored(card)) reasons.push("Ignored");
        if (card.dataset.nliExpHidden === "true") reasons.push("Experience");
        if (card.dataset.nliKwHidden === "true") reasons.push("Keywords");
        if (card.dataset.nliLocHidden === "true") reasons.push("Location");

        const exp = getCardMinExp(card);
        const loc = getCardLocation(card);

        // Get the job detail URL from the title link
        const linkEl = card.querySelector('a.title, .title a, [class*="title"] a, a[title], .row1 a, .row2 a');
        const url = linkEl ? linkEl.href : null;

        hiddenJobs.push({
          title,
          company,
          reasons,
          exp: exp !== null ? exp + " yrs" : null,
          location: loc || null,
          url,
        });
      });
      sendResponse({ hiddenJobs });
      return true;
    }

    // Exp filter changed from side panel
    if (message.action === "expFilterChanged") {
      expFilterEnabled = message.enabled;
      expFilterMax = message.maxAllowed;
      document.querySelectorAll('[data-nli-exp-checked]').forEach(el => {
        delete el.dataset.nliExpChecked; delete el.dataset.nliExpHidden;
        syncDisplay(el);
      });
      applyExpFilter();
      checkAutoSkip();
    }

    // Keyword filter changed
    if (message.action === "kwFilterChanged") {
      kwFilterEnabled = message.enabled;
      kwFilterKeywords = message.keywords || [];
      document.querySelectorAll('[data-nli-kw-checked]').forEach(el => {
        delete el.dataset.nliKwChecked; delete el.dataset.nliKwHidden;
        syncDisplay(el);
      });
      applyKeywordFilter();
      checkAutoSkip();
    }

    // Keyword exclude filter changed
    if (message.action === "kwExcludeFilterChanged") {
      kwExcludeEnabled = message.enabled;
      kwExcludeKeywords = message.keywords || [];
      document.querySelectorAll('[data-nli-kw-checked]').forEach(el => {
        delete el.dataset.nliKwChecked; delete el.dataset.nliKwHidden;
        syncDisplay(el);
      });
      applyKeywordFilter();
      checkAutoSkip();
      if (scannerActive) runScanner();
    }

    // Location filter changed
    if (message.action === "locFilterChanged") {
      locFilterEnabled = message.enabled;
      locFilterCities = message.cities || [];
      document.querySelectorAll('[data-nli-loc-checked]').forEach(el => {
        delete el.dataset.nliLocChecked; delete el.dataset.nliLocHidden;
        syncDisplay(el);
      });
      applyLocationFilter();
      checkAutoSkip();
      if (scannerActive) runScanner();
    }

    if (message.action === "clearScannedMatches") {
      // logic removed
    }

    // Auto-skip logic
    if (message.action === "autoSkipChanged") {
      autoSkipEnabled = message.enabled;
      if (!autoSkipEnabled) {
        safeStorage.set({ autoSkipCount: 0 });
        if (autoSkipTimer) { clearTimeout(autoSkipTimer); autoSkipTimer = null; }
      } else {
        checkAutoSkip();
      }
    }
    if (message.action === "resetAutoSkip") {
      if (autoSkipTimer) { clearTimeout(autoSkipTimer); autoSkipTimer = null; }
      checkAutoSkip();
    }

    // Sidepanel requests full ignored jobs list (from storage, not just current page)
    if (message.action === "getIgnoredList") {
      safeStorage.get(["ignoredJobs"], (r) => {
        const cache = r.ignoredJobs || {};
        const list = Object.entries(cache).map(([key, val]) => ({
          key,
          company: val.company || "",
          title: val.title || "",
          hiddenAt: val.hiddenAt || null,
        }));
        list.sort((a, b) => (b.hiddenAt || "").localeCompare(a.hiddenAt || ""));
        sendResponse({ list });
      });
      return true;
    }

    // Restore a single ignored job
    if (message.action === "restoreIgnored") {
      safeStorage.get(["ignoredJobs"], (r) => {
        const cache = r.ignoredJobs || {};
        delete cache[message.key];
        ignoredJobsCache = cache;
        safeStorage.set({ ignoredJobs: cache }, () => {
          // Show any matching card on current page
          document.querySelectorAll(CARD_SELECTOR).forEach(card => {
            if (getCardKey(card) === message.key) {
              delete card.dataset.nliChecked;
              syncDisplay(card);
            }
          });
          sendResponse({ ok: true });
        });
      });
      return true;
    }

    // Clear all ignored jobs
    if (message.action === "clearIgnored") {
      ignoredJobsCache = {};
      safeStorage.set({ ignoredJobs: {} }, () => {
        fullReset();
        runAllFilters();
        injectHideButtons();
        sendResponse({ ok: true });
      });
      return true;
    }
  });
} // end if(ctxOk())