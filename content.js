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
  // "5-10 Yrs", "5 - 10 Yrs", "5–10 Yrs"
  const rangeMatch = t.match(/(\d+)\s*[-–—]\s*\d+\s*(?:yr|year)/i);
  if (rangeMatch) return parseInt(rangeMatch[1], 10);
  // "5+ Yrs"
  const plusMatch = t.match(/(\d+)\s*\+\s*(?:yr|year)?/i);
  if (plusMatch) return parseInt(plusMatch[1], 10);
  // "5 Yrs", "5 Years"
  const singleMatch = t.match(/(\d+)\s*(?:yr|year)/i);
  if (singleMatch) return parseInt(singleMatch[1], 10);
  // plain number at start
  const numMatch = t.match(/^(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  return null;
}

function getCardMinExp(card) {
  // 1. Try specific selectors first (fastest)
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

  // 2. Scan all spans/small elements for text containing "Yr" or "Year"
  const candidates = card.querySelectorAll('span, li, div.row2, div.row3');
  for (const el of candidates) {
    const txt = (el.getAttribute("title") || el.innerText || "").trim();
    if (/\d+\s*[-–—+]?\s*\d*\s*(?:yr|year)/i.test(txt) || /fresher/i.test(txt)) {
      const minExp = parseMinExperience(txt);
      if (minExp !== null) return minExp;
    }
  }

  // 3. Final fallback: regex scan the entire card text
  const fullText = card.innerText || "";
  const expPattern = fullText.match(/(\d+\s*[-–—]\s*\d+\s*(?:Yrs?|Years?))/i)
    || fullText.match(/(\d+\s*\+?\s*(?:Yrs?|Years?))/i);
  if (expPattern) {
    const minExp = parseMinExperience(expPattern[1]);
    if (minExp !== null) return minExp;
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

let appliedJobsCache = {};
let ignoredJobsCache = {};
let expFilterEnabled = false;
let expFilterMax = 2;
let kwFilterEnabled = false;
let kwFilterKeywords = [];
let locFilterEnabled = false;
let locFilterCities = [];
let storageReady = false;

// ── Auto-Skip state ───────────────────────────────────────────────────────────
let autoSkipEnabled = false;
let autoSkipTimer = null;

// ── Toast ────────────────────────────────────────────────────────────────────

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

  // Find the header area where Save/Apply buttons live
  const headerSelectors = [
    '[class*="jd-header-content"]',
    '[class*="jd-header"]',
    '[class*="styles_jhc"]',
    'div[class*="header-main"]',
  ];
  let anchor = null;
  for (const sel of headerSelectors) {
    anchor = document.querySelector(sel);
    if (anchor) break;
  }
  // Fallback: insert after the h1 title
  if (!anchor) anchor = document.querySelector('h1');
  if (!anchor) return;

  const company = extractCompanyName();
  const position = extractJobPosition();
  if (!company || !position) return;

  const key = makeKey(company, position);
  const alreadyIgnored = !!ignoredJobsCache[key];

  const btn = document.createElement("button");
  btn.id = "nli-detail-ignore-btn";
  btn.innerHTML = alreadyIgnored ? "✅ Restored — showing again" : "👎 Not Interested";
  btn.style.cssText = `
    display: inline-flex; align-items: center; gap: 6px;
    margin: 10px 0 0 0;
    padding: 7px 16px;
    background: ${alreadyIgnored ? "#f0fdf4" : "#fff"};
    color: ${alreadyIgnored ? "#16a34a" : "#6b7280"};
    border: 1.5px solid ${alreadyIgnored ? "#86efac" : "#e5e7eb"};
    border-radius: 20px;
    font-size: 13px; font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,.07);
    transition: all .15s;
  `;

  btn.addEventListener("mouseenter", () => {
    if (btn.dataset.ignored === "true") return;
    btn.style.background = "#fef2f2";
    btn.style.borderColor = "#fca5a5";
    btn.style.color = "#dc2626";
  });
  btn.addEventListener("mouseleave", () => {
    if (btn.dataset.ignored === "true") return;
    btn.style.background = "#fff";
    btn.style.borderColor = "#e5e7eb";
    btn.style.color = "#6b7280";
  });

  btn.addEventListener("click", () => {
    if (btn.dataset.ignored === "true") {
      // Restore
      delete ignoredJobsCache[key];
      safeStorage.set({ ignoredJobs: ignoredJobsCache }, () => {
        btn.dataset.ignored = "false";
        btn.innerHTML = "👎 Not Interested";
        btn.style.background = "#fff";
        btn.style.borderColor = "#e5e7eb";
        btn.style.color = "#6b7280";
        showToast(`↩ Restored: <b>${position}</b> at <b>${company}</b>`, "success", 3000);
        safeMsg({ action: "ignoredJobsUpdated" });
      });
    } else {
      // Ignore
      ignoredJobsCache[key] = { company, title: position, hiddenAt: new Date().toISOString() };
      safeStorage.set({ ignoredJobs: ignoredJobsCache }, () => {
        btn.dataset.ignored = "true";
        btn.innerHTML = "✅ Hidden — click to restore";
        btn.style.background = "#fffbeb";
        btn.style.borderColor = "#fde68a";
        btn.style.color = "#b45309";
        showToast(`👎 Hidden: <b>${position}</b><br><span style="font-weight:400;font-size:12px">at ${company} — won't show again in listings</span>`, "warning", 4000);
        safeMsg({ action: "ignoredJobsUpdated" });
      });
    }
  });

  btn.dataset.ignored = alreadyIgnored ? "true" : "false";
  // Insert right after the anchor element
  anchor.insertAdjacentElement("afterend", btn);
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
  let hiddenCount = 0;

  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
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

  safeMsg({ action: "kwFilterStatus", hiddenCount });
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

// ── Storage bootstrap ─────────────────────────────────────────────────────────

function loadFromStorage(callback) {
  safeStorage.get(["appliedJobs", "ignoredJobs", "expFilter", "kwFilter", "locFilter", "autoSkip"], (result) => {
    appliedJobsCache = result.appliedJobs || {};
    ignoredJobsCache = result.ignoredJobs || {};

    const ef = result.expFilter || { enabled: false, maxAllowed: 2 };
    expFilterEnabled = ef.enabled;
    expFilterMax = ef.maxAllowed;

    const kf = result.kwFilter || { enabled: false, keywords: [] };
    kwFilterEnabled = kf.enabled;
    kwFilterKeywords = kf.keywords || [];

    const lf = result.locFilter || { enabled: false, cities: [] };
    locFilterEnabled = lf.enabled;
    locFilterCities = lf.cities || [];

    const as = result.autoSkip || { enabled: false };
    autoSkipEnabled = as.enabled;

    storageReady = true;
    if (callback) callback();
  });
}

// ── Auto-Skip helpers ─────────────────────────────────────────────────────────

// ── Page type detection ───────────────────────────────────────────────────────

function isJobDetailPage() {
  // Job detail URLs: /job-listings-*, /jobdetail*, or contain sid= parameter with no pagination
  const url = window.location.href;
  return /naukri\.com\/job-listings-/.test(url) ||
         /naukri\.com\/jobdetail/.test(url) ||
         (/sid=/.test(url) && !/[?&]k=/.test(url));
}

function isSearchResultsPage() {
  const url = window.location.href;
  // Search results have ?k= or path like /cyber-jobs-12
  return /[?&]k=/.test(url) || /naukri\.com\/[a-z-]+-jobs/.test(url);
}

function countVisibleCards() {
  let count = 0;
  document.querySelectorAll(CARD_SELECTOR).forEach(card => {
    if (card.style.display !== "none") count++;
  });
  return count;
}

function findNextPageButton() {
  // 1. Try aria-label first (most reliable)
  const ariaNext = document.querySelector('a[aria-label="Next"], button[aria-label="Next"]');
  if (ariaNext) return ariaNext;

  // 2. Try class-based selectors Naukri uses
  const classNext = document.querySelector(
    'a.next, .next > a, [class*="nextBtn"], [class*="next-btn"], [class*="next_btn"], a[title="Next"]'
  );
  if (classNext) return classNext;

  // 3. Scan pagination wrapper for an element whose text *contains* "next"
  const pagWrapper = document.querySelector(
    '.pagination-wrapper, [class*="pagination"], .pages-list, .srp-pagination, [class*="Pagination"]'
  );
  if (pagWrapper) {
    const links = pagWrapper.querySelectorAll("a, button, span");
    for (const el of links) {
      const txt = (el.innerText || el.textContent || "").toLowerCase().trim();
      if (txt.includes("next")) return el;
    }
  }

  // 4. Last resort: any anchor/button on the page whose text contains "next"
  for (const el of document.querySelectorAll("a, button")) {
    const txt = (el.innerText || el.textContent || "").toLowerCase().trim();
    if (txt.includes("next") && !txt.includes("previous") && txt.length < 12) return el;
  }

  return null;
}

function checkAutoSkip() {
  // Never auto-skip on a job detail page — no cards exist there
  if (!autoSkipEnabled || !storageReady || isJobDetailPage()) return;
  if (autoSkipTimer) clearTimeout(autoSkipTimer);

  autoSkipTimer = setTimeout(() => {
    autoSkipTimer = null;
    const visible = countVisibleCards();

    if (visible === 0) {
      // All jobs filtered out on this page — try to go to next
      const nextBtn = findNextPageButton();
      if (!nextBtn) {
        // No next page — end of results
        safeStorage.get(["autoSkipCount"], (r) => {
          const n = r.autoSkipCount || 0;
          safeStorage.set({ autoSkipCount: 0 });
          showToast(
            `🔍 Reached the last page. No matching jobs found${n > 0 ? ` after skipping <b>${n}</b> page${n !== 1 ? "s" : ""}` : ""}.`,
            "error", 7000
          );
        });
        return;
      }
      // Increment skip count and navigate
      safeStorage.get(["autoSkipCount"], (r) => {
        const newCount = (r.autoSkipCount || 0) + 1;
        safeStorage.set({ autoSkipCount: newCount }, () => {
          showToast(
            `⏭ Page has <b>0 matching jobs</b> — auto-skipping... (<b>${newCount}</b> page${newCount !== 1 ? "s" : ""} skipped)`,
            "warning", 1800
          );
          setTimeout(() => nextBtn.click(), 800);
        });
      });
    } else {
      // Found matching jobs — check if we skipped any pages
      safeStorage.get(["autoSkipCount"], (r) => {
        const n = r.autoSkipCount || 0;
        if (n > 0) {
          safeStorage.set({ autoSkipCount: 0 });
          showToast(
            `✅ Found <b>${visible}</b> matching job${visible !== 1 ? "s" : ""}!<br><span style="font-weight:400;font-size:12px">Auto-skipped <b>${n}</b> empty page${n !== 1 ? "s" : ""} to get here.</span>`,
            "success", 6000
          );
          // Notify sidepanel to update skip count display
          safeMsg({ action: "autoSkipResult", skipped: n, found: visible });
        }
      });
    }
  }, 2000); // Wait for all filters to settle before deciding
}

loadFromStorage(() => {
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
      fullReset(); runAllFilters(); injectHideButtons(); injectDetailPageButton(); checkAutoSkip();
    }
    if (changes.ignoredJobs) {
      ignoredJobsCache = changes.ignoredJobs.newValue || {};
      fullReset(); runAllFilters(); injectHideButtons(); injectDetailPageButton(); checkAutoSkip();
    }
  });
}

// ── MutationObserver (debounced) ──────────────────────────────────────────────

let _obsTimer = null;
const observer = new MutationObserver(() => {
  if (!storageReady) return;
  if (_obsTimer) return;
  _obsTimer = setTimeout(() => {
    _obsTimer = null;
    runAllFilters();
    injectHideButtons();
    injectDetailPageButton();
    checkAutoSkip();
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
      const name = el.innerText?.trim() || el.getAttribute("title")?.replace(" Careers", "").trim();
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
  }

  // Auto-skip changed
  if (message.action === "autoSkipChanged") {
    autoSkipEnabled = message.enabled;
    if (!autoSkipEnabled) {
      safeStorage.set({ autoSkipCount: 0 });
      if (autoSkipTimer) { clearTimeout(autoSkipTimer); autoSkipTimer = null; }
    } else {
      checkAutoSkip();
    }
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
