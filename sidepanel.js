// sidepanel.js

// ── Preset data ───────────────────────────────────────────────────────────────

const PRESET_KEYWORDS = [];

const PRESET_LOCATIONS = [];

const DEFAULT_LOCATIONS = [
  "bangalore", "bengaluru", "remote", "chennai", "hyderabad",
  "coimbatore", "ernakulam", "kochi", "kozhikode",
  "thiruvananthapuram", "mangalore", "mysore", "kerala",
];

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") loadHistory();
    if (tab.dataset.tab === "hidden") loadHiddenJobs();
  });
});

// ── Shared util ───────────────────────────────────────────────────────────────
function escHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function sendToTab(action, payload) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && /naukri\.com/.test(tabs[0].url)) {
      chrome.tabs.sendMessage(tabs[0].id, { action, ...payload }, () => { void chrome.runtime.lastError; });
    }
  });
}

// ── Experience Filter ─────────────────────────────────────────────────────────
const chkExpFilter = document.getElementById("chk-exp-filter");
const expFilterCard = document.getElementById("exp-filter-card");
const expChipsRow = document.getElementById("exp-chips-row");
const expHintVal = document.getElementById("exp-hint-val");
const expStatus = document.getElementById("exp-status");
const expStatusTx = document.getElementById("exp-status-text");
const expChips = document.querySelectorAll("#exp-chips-row .chip");

let expFilterEnabled = false;
let expFilterMaxAllowed = 2;

chrome.storage.local.get(["expFilter"], (r) => {
  const s = r.expFilter || { enabled: false, maxAllowed: 2 };
  expFilterEnabled = s.enabled;
  expFilterMaxAllowed = s.maxAllowed;
  chkExpFilter.checked = expFilterEnabled;
  applyExpCardState();
  setActiveExpChip(expFilterMaxAllowed);
  expHintVal.textContent = expFilterMaxAllowed;
});

chkExpFilter.addEventListener("change", () => {
  expFilterEnabled = chkExpFilter.checked;
  applyExpCardState();
  broadcastExp();
});

expChips.forEach(chip => {
  chip.addEventListener("click", () => {
    if (!expFilterEnabled) return;
    expFilterMaxAllowed = parseInt(chip.dataset.val, 10);
    setActiveExpChip(expFilterMaxAllowed);
    expHintVal.textContent = expFilterMaxAllowed;
    broadcastExp();
  });
});

function applyExpCardState() {
  expFilterCard.classList.toggle("active-blue", expFilterEnabled);
  expChipsRow.classList.toggle("disabled", !expFilterEnabled);
  expStatus.classList.toggle("off", !expFilterEnabled);
  expStatusTx.textContent = expFilterEnabled ? "Filter active" : "Filter off";
}
function setActiveExpChip(val) {
  expChips.forEach(c => c.classList.toggle("active", parseInt(c.dataset.val, 10) === val));
}
function broadcastExp() {
  const prefs = { enabled: expFilterEnabled, maxAllowed: expFilterMaxAllowed };
  chrome.storage.local.set({ expFilter: prefs }, () => sendToTab("expFilterChanged", prefs));
}

// ── Generic tag filter factory ────────────────────────────────────────────────
// Builds keyword-style and location-style filter UIs from shared logic.

function makeTagFilter({ storageKey, tagsAreaId, inputId, addBtnId, presetsId, statusId, statusTxId, cardId,
  filterAction, activeClass, pillClass, presets, emptyText, msgAction, defaultItems }) {

  const tagsArea = document.getElementById(tagsAreaId);
  const input = document.getElementById(inputId);
  const addBtn = document.getElementById(addBtnId);
  const presetsEl = document.getElementById(presetsId);
  const statusEl = document.getElementById(statusId);
  const statusTx = document.getElementById(statusTxId);
  const cardEl = document.getElementById(cardId);

  // Find the toggle inside the card
  const toggle = cardEl.querySelector('input[type="checkbox"]');

  let enabled = false;
  let items = [];

  // Load
  chrome.storage.local.get([storageKey], (r) => {
    const itemKey = filterAction === "kwFilterChanged" ? "keywords" : "cities";
    const defaults = defaultItems || [];
    const s = r[storageKey] || { enabled: defaults.length > 0, [itemKey]: defaults };
    enabled = s.enabled;
    items = (s.keywords || s.cities || []).slice();
    if (items.length === 0 && defaults.length > 0) { items = defaults.slice(); enabled = true; }
    toggle.checked = enabled;
    applyCardState();
    renderTags();
    renderPresets();
    if (!r[storageKey] && defaults.length > 0) broadcast(); // save defaults to storage
  });

  toggle.addEventListener("change", () => {
    enabled = toggle.checked;
    applyCardState();
    broadcast();
  });

  addBtn.addEventListener("click", addFromInput);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") addFromInput(); });

  function addFromInput() {
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    addItem(val);
    input.value = "";
    input.focus();
  }

  function addItem(item) {
    const k = item.toLowerCase().trim();
    if (!k || items.includes(k)) return;
    items.push(k);
    renderTags();
    renderPresets();
    broadcast();
  }

  function removeItem(item) {
    items = items.filter(i => i !== item);
    renderTags();
    renderPresets();
    broadcast();
  }

  function renderTags() {
    tagsArea.innerHTML = "";
    if (items.length === 0) {
      tagsArea.innerHTML = `<span class="tags-empty">${emptyText}</span>`;
      return;
    }
    items.forEach(item => {
      const tag = document.createElement("span");
      tag.className = `tag-pill ${pillClass}`;
      const isPreset = presets.map(p => p.toLowerCase()).includes(item);
      if (!isPreset) tag.classList.add("custom");
      tag.innerHTML = `<span>${escHtml(item)}</span><button class="tag-pill-del" title="Remove">×</button>`;
      tag.querySelector(".tag-pill-del").addEventListener("click", () => removeItem(item));
      tagsArea.appendChild(tag);
    });
  }

  function renderPresets() {
    presetsEl.innerHTML = "";
    presets.forEach(preset => {
      const k = preset.toLowerCase();
      const chip = document.createElement("span");
      chip.className = `preset-chip ${pillClass.includes("kw") ? "purple" : "teal"}${items.includes(k) ? " added" : ""}`;
      chip.textContent = preset;
      chip.title = items.includes(k) ? "Already added" : "Click to add";
      chip.addEventListener("click", () => addItem(k));
      presetsEl.appendChild(chip);
    });
  }

  function applyCardState() {
    cardEl.classList.toggle(activeClass, enabled);
    statusEl.classList.toggle("off", !enabled);
    if (activeClass === "active-teal") statusEl.classList.toggle("teal", enabled);
    if (activeClass === "active-purple") statusEl.classList.toggle("purple", enabled);
    updateStatus(null);
  }

  function updateStatus(count) {
    if (!enabled) { statusTx.textContent = "Filter off"; return; }
    if (count === null) { statusTx.textContent = items.length > 0 ? "Filter active" : "No items set"; return; }
    statusTx.textContent = count > 0 ? `${count} job${count !== 1 ? "s" : ""} hidden` : "Filter active — 0 hidden";
  }

  function broadcast() {
    const key = filterAction === "kwFilterChanged" ? "keywords" : "cities";
    const payload = { enabled, [key]: items };
    chrome.storage.local.set({ [storageKey]: payload }, () =>
      sendToTab(filterAction, payload)
    );
  }

  // Return update function so message handler can call it
  return { updateStatus };
}

// ── Build keyword filter ──────────────────────────────────────────────────────
const kwFilter = makeTagFilter({
  storageKey: "kwFilter",
  tagsAreaId: "kw-tags-area",
  inputId: "kw-input",
  addBtnId: "kw-add-btn",
  presetsId: "kw-presets",
  statusId: "kw-status",
  statusTxId: "kw-status-text",
  cardId: "kw-filter-card",
  filterAction: "kwFilterChanged",
  activeClass: "active-purple",
  pillClass: "kw-tag",
  presets: PRESET_KEYWORDS,
  emptyText: "No keywords yet — add from presets or type below",
});

// ── Build location filter ─────────────────────────────────────────────────────
const locFilter = makeTagFilter({
  storageKey: "locFilter",
  tagsAreaId: "loc-tags-area",
  inputId: "loc-input",
  addBtnId: "loc-add-btn",
  presetsId: "loc-presets",
  statusId: "loc-status",
  statusTxId: "loc-status-text",
  cardId: "loc-filter-card",
  filterAction: "locFilterChanged",
  activeClass: "active-teal",
  pillClass: "loc-tag",
  presets: PRESET_LOCATIONS,
  emptyText: "No locations yet — type below to add",
  defaultItems: DEFAULT_LOCATIONS,
});

// ── Listen for status updates from content script ─────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "expFilterStatus" && expFilterEnabled) {
    expStatusTx.textContent = message.hiddenCount > 0
      ? `${message.hiddenCount} job${message.hiddenCount !== 1 ? "s" : ""} hidden`
      : "Filter active — 0 hidden";
  }
  if (message.action === "kwFilterStatus") kwFilter.updateStatus(message.hiddenCount);
  if (message.action === "locFilterStatus") locFilter.updateStatus(message.hiddenCount);
});

// ── Search option checkboxes ──────────────────────────────────────────────────
const checkboxes = {
  linkedin: document.getElementById("chk-linkedin"),
  dork: document.getElementById("chk-dork"),
  people: document.getElementById("chk-people"),
};
const rows = {
  linkedin: document.getElementById("row-linkedin"),
  dork: document.getElementById("row-dork"),
  people: document.getElementById("row-people"),
};

chrome.storage.local.get(["openPrefs"], (r) => {
  const prefs = r.openPrefs || { linkedin: true, dork: true, people: true };
  Object.keys(checkboxes).forEach(key => {
    checkboxes[key].checked = prefs[key] !== false;
    rows[key].classList.toggle("checked", checkboxes[key].checked);
  });
});
Object.keys(checkboxes).forEach(key => {
  checkboxes[key].addEventListener("change", () => {
    rows[key].classList.toggle("checked", checkboxes[key].checked);
    chrome.storage.local.set({
      openPrefs: {
        linkedin: checkboxes.linkedin.checked,
        dork: checkboxes.dork.checked,
        people: checkboxes.people.checked,
      }
    });
  });
});

// ── History ───────────────────────────────────────────────────────────────────
const historyList = document.getElementById("historyList");
const historyCount = document.getElementById("history-count");
const clearBtn = document.getElementById("clearBtn");

loadHistory();
clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all application history?")) return;
  chrome.runtime.sendMessage({ action: "clearHistory" }, () => loadHistory());
});

function loadHistory() {
  chrome.runtime.sendMessage({ action: "getHistory" }, (response) => {
    const jobs = response?.jobs || [];
    historyCount.textContent = `${jobs.length} entr${jobs.length !== 1 ? "ies" : "y"}`;
    if (jobs.length === 0) {
      historyList.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No history yet.<br>Press <b>Ctrl+Shift+L</b> on a<br>Naukri job listing to start.</p></div>`;
      return;
    }
    historyList.innerHTML = "";
    jobs.forEach(job => {
      const item = document.createElement("div");
      item.className = "history-item";
      const date = new Date(job.firstSeen).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      item.innerHTML = `<div class="history-dot"></div><div class="history-item-body"><div class="history-company">${escHtml(job.company)}</div><div class="history-position">${escHtml(job.position || "—")}</div><div class="history-date">${date}</div></div><button class="del-btn" title="Remove">×</button>`;
      item.querySelector(".del-btn").addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "deleteEntry", company: job.company, position: job.position }, () => loadHistory());
      });
      historyList.appendChild(item);
    });
  });
}

// ── Hidden Jobs ──────────────────────────────────────────────────────────────
const hiddenList = document.getElementById("hiddenList");
const hiddenCount = document.getElementById("hidden-count");
const refreshHiddenBtn = document.getElementById("refreshHiddenBtn");

refreshHiddenBtn.addEventListener("click", loadHiddenJobs);

const REASON_CLASSES = { Applied: "applied", Experience: "exp", Keywords: "keywords", Location: "location" };

function loadHiddenJobs() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].url || !/naukri\.com/.test(tabs[0].url)) {
      hiddenCount.textContent = "—";
      hiddenList.innerHTML = `<div class="empty-state"><div class="empty-icon">🌐</div><p>Open a Naukri search page<br>to see hidden jobs here.</p></div>`;
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { action: "getHiddenJobs" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        hiddenCount.textContent = "—";
        hiddenList.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not reach the page.<br>Try refreshing the Naukri tab.</p></div>`;
        return;
      }
      const jobs = response.hiddenJobs || [];
      hiddenCount.textContent = `${jobs.length} hidden job${jobs.length !== 1 ? "s" : ""}`;
      if (jobs.length === 0) {
        hiddenList.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>No jobs are hidden right now.<br>All cards are visible.</p></div>`;
        return;
      }
      hiddenList.innerHTML = "";
      jobs.forEach(job => {
        const item = document.createElement("div");
        item.className = "hidden-item";
        if (job.url) {
          item.style.cursor = "pointer";
          item.title = "Click to open job details";
          item.addEventListener("click", () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]) chrome.tabs.update(tabs[0].id, { url: job.url });
            });
          });
        }
        const metaParts = [];
        if (job.exp) metaParts.push(`Exp: ${escHtml(job.exp)}`);
        if (job.location) metaParts.push(`📍 ${escHtml(job.location)}`);
        const badges = job.reasons.map(r =>
          `<span class="reason-badge ${REASON_CLASSES[r] || ""}">${escHtml(r)}</span>`
        ).join("");
        item.innerHTML = `
          <div class="hidden-item-title">${escHtml(job.title)}</div>
          <div class="hidden-item-company">${escHtml(job.company)}</div>
          ${metaParts.length ? `<div class="hidden-item-meta">${metaParts.join(" · ")}</div>` : ""}
          <div class="hidden-item-reasons">${badges}</div>
        `;
        hiddenList.appendChild(item);
      });
    });
  });
}
