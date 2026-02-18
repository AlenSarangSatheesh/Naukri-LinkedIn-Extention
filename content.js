// content.js — Runs on all naukri.com pages
console.log("[NaukriLinkedIn] ✅ Content script loaded on:", window.location.href);

// ── Shared Helpers ──────────────────────────────────────────────────────────

function makeKey(company, position) {
  const c = (company || "").toLowerCase().trim();
  const p = (position || "").toLowerCase().trim();
  return `${c}||${p}`;
}

// ── Extractors (Job Details Page) ───────────────────────────────────────────

function extractCompanyName() {
  const selectors = [
    'div[class*="styles_jd-header-comp-name"] a',
    '[class*="jd-header-comp-name"] a',
    'a[href*="-jobs-careers-"]',
    'a[title*="Careers"]',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      const name = el.innerText?.trim() || el.getAttribute("title")?.replace(" Careers", "").trim();
      if (name) return name;
    }
  }
  return null;
}

function extractJobPosition() {
  const selectors = [
    'h1[class*="jd-header-title"]',
    '[class*="jd-header-title"] h1',
    '[class*="jd-header-title"]',
    'h1',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 0) return text;
    }
  }
  return null;
}

// ── Toast ────────────────────────────────────────────────────────────────────

function showToast(message, type = "success", duration = 4000) {
  const existing = document.getElementById("nli-toast");
  if (existing) existing.remove();

  const colors = { success: "#0A66C2", error: "#dc2626", warning: "#b45309" };
  const icons = { success: "🔗", error: "⚠️", warning: "🚨" };

  const toast = document.createElement("div");
  toast.id = "nli-toast";
  toast.style.cssText = `
    position: fixed;
    bottom: 30px;
    right: 30px;
    z-index: 999999;
    background: ${colors[type]};
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 6px 24px rgba(0,0,0,0.3);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 380px;
    line-height: 1.5;
    animation: nliSlideIn 0.3s ease;
    cursor: pointer;
  `;

  toast.innerHTML = `
    <style>
      @keyframes nliSlideIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      @keyframes nliSlideOut { from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(20px)} }
    </style>
    <span style="font-size:22px;line-height:1.2">${icons[type]}</span>
    <span>${message}</span>
  `;

  toast.addEventListener("click", () => toast.remove());
  document.body.appendChild(toast);

  setTimeout(() => {
    if (!toast.parentNode) return;
    toast.style.animation = "nliSlideOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Job Search Page: Auto-Detect & Mark ──────────────────────────────────────

let appliedJobsCache = {};

// 1. Sync data from storage
function updateCache() {
  chrome.storage.local.get("appliedJobs", (result) => {
    appliedJobsCache = result.appliedJobs || {};

    // Reset checked flags so ALL cards get re-evaluated against new data
    document.querySelectorAll('[data-nli-checked]').forEach(el => {
      delete el.dataset.nliChecked;
    });

    scanAndMarkJobs(); // Re-scan whenever data changes
  });
}
updateCache();
chrome.storage.onChanged.addListener(updateCache);

// 2. Tooltip Logic
let tooltipEl = null;

function showTooltip(target, jobData) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.style.cssText = `
      position: absolute;
      z-index: 100000;
      background: #004182;
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      white-space: nowrap;
    `;
    document.body.appendChild(tooltipEl);
  }

  const date = new Date(jobData.firstSeen).toLocaleDateString("en-IN", {
    day: "numeric", month: "short"
  });

  tooltipEl.innerHTML = `✅ Applied/Searched on <b>${date}</b>`;

  const rect = target.getBoundingClientRect();
  tooltipEl.style.top = `${window.scrollY + rect.top - 40}px`;
  tooltipEl.style.left = `${window.scrollX + rect.left + 20}px`;
  tooltipEl.style.display = "block";
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = "none";
}

// 3. Mark applied jobs visually
function scanAndMarkJobs() {
  // Selectors for job cards on search result pages
  // Handles typical "srp-jobtuple-wrapper" and other common Naukri containers
  const cards = document.querySelectorAll('.srp-jobtuple-wrapper, [class*="jobTuple"], .list');

  cards.forEach(card => {
    // Avoid marking the same card repeatedly if status hasn't changed
    if (card.dataset.nliChecked === "true" && !card.dataset.nliNeedsUpdate) return;

    // Extract Title
    const titleEl = card.querySelector('.title, a[title]');
    // Extract Company
    const companyEl = card.querySelector('.comp-name, .subTitle, a[title*="Careers"]');

    if (!titleEl || !companyEl) return;

    const position = titleEl.innerText.trim();
    const company = companyEl.innerText.trim();
    const key = makeKey(company, position);

    // If matches history
    if (appliedJobsCache[key]) {
      // VISUAL: Add a border or background style
      card.style.border = "2px solid #34d399"; // Green border
      card.style.background = "rgba(52, 211, 153, 0.05)"; // Very light green tint
      card.setAttribute("title", `✅ Already applied on ${new Date(appliedJobsCache[key].firstSeen).toLocaleDateString()}`); // Native tooltip

      // VISUAL: Add a small badge
      if (!card.querySelector('.nli-badge')) {
        const badge = document.createElement("div");
        badge.className = "nli-badge";
        badge.innerText = "✅ APPLIED";
        badge.style.cssText = `
          position: absolute;
          top: 10px;
          right: 10px;
          background: #059669;
          color: white;
          font-size: 10px;
          font-weight: bold;
          padding: 2px 6px;
          border-radius: 4px;
          z-index: 10;
        `;
        // Ensure card has positioning context
        if (getComputedStyle(card).position === 'static') {
          card.style.position = 'relative';
        }
        card.appendChild(badge);
      }

      // HOVER: Add custom tooltip listener
      card.addEventListener("mouseenter", () => showTooltip(card, appliedJobsCache[key]));
      card.addEventListener("mouseleave", hideTooltip);
    }

    card.dataset.nliChecked = "true";
  });
}

// 4. Observer: Watch for new jobs loading (Infinite Scroll)
const observer = new MutationObserver((mutations) => {
  // Simple throttle/debounce could be added if page is very heavy
  scanAndMarkJobs();
});

observer.observe(document.body, { childList: true, subtree: true });


// ── Main action (Job Details Page) ──────────────────────────────────────────

function openLinkedIn() {
  const company = extractCompanyName();
  const position = extractJobPosition();

  console.log("[NaukriLinkedIn] Company:", company, "| Position:", position);

  if (!company) {
    showToast("No company name found. Please open a specific job listing.", "error");
    return;
  }

  chrome.runtime.sendMessage(
    { action: "checkAndOpen", company, position },
    (response) => {
      if (response && response.alreadyApplied) {
        showToast(
          `Already searched/applied!<br><b>${position || "This role"}</b> at <b>${company}</b><br><span style="font-weight:400;opacity:0.9;font-size:12px">First seen: ${response.firstSeen}</span>`,
          "warning",
          8000
        );
      } else {
        showToast(`Searching LinkedIn for: <b>${company}</b>`, "success");
      }
    }
  );
}

// ── Keyboard shortcut ────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "L") {
    e.preventDefault();
    openLinkedIn();
  }
});

// ── Messages from popup ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getCompany") {
    const company = extractCompanyName();
    const position = extractJobPosition();
    sendResponse({ company, position });
  }
  if (message.action === "triggerSearch") {
    openLinkedIn();
  }
});