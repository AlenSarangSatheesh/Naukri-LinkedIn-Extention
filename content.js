// content.js — Runs on all naukri.com pages
console.log("[NaukriLinkedIn] ✅ Content script loaded on:", window.location.href);

// ── Extractors ───────────────────────────────────────────────────────────────

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
  const icons  = { success: "🔗", error: "⚠️", warning: "🚨" };

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

// ── Main action ───────────────────────────────────────────────────────────────

function openLinkedIn() {
  const company  = extractCompanyName();
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
    const company  = extractCompanyName();
    const position = extractJobPosition();
    sendResponse({ company, position });
  }
  if (message.action === "triggerSearch") {
    openLinkedIn();
  }
});
