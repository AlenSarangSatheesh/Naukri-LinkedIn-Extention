// popup.js

const historyList = document.getElementById("historyList");
const clearBtn = document.getElementById("clearBtn");

// ── LinkedIn / Search checkboxes ──────────────────────────────────────────────

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

chrome.storage.local.get(["openPrefs"], (result) => {
  const prefs = result.openPrefs || { linkedin: true, dork: true, people: true };
  Object.keys(checkboxes).forEach((key) => {
    checkboxes[key].checked = prefs[key] !== false;
    rows[key].classList.toggle("checked", checkboxes[key].checked);
  });
});

Object.keys(checkboxes).forEach((key) => {
  checkboxes[key].addEventListener("change", () => {
    rows[key].classList.toggle("checked", checkboxes[key].checked);
    const prefs = {
      linkedin: checkboxes.linkedin.checked,
      dork: checkboxes.dork.checked,
      people: checkboxes.people.checked,
    };
    chrome.storage.local.set({ openPrefs: prefs });
  });
});

// ── Experience Filter ─────────────────────────────────────────────────────────

const chkExpFilter = document.getElementById("chk-exp-filter");
const expFilterBox = document.getElementById("exp-filter-box");
const expChipsRow = document.getElementById("exp-chips-row");
const expHintVal = document.getElementById("exp-hint-val");
const chips = document.querySelectorAll(".exp-chip");

let expFilterEnabled = false;
let expFilterMaxAllowed = 2; // hide jobs needing > this many years

// Load saved exp filter prefs
chrome.storage.local.get(["expFilter"], (result) => {
  const saved = result.expFilter || { enabled: false, maxAllowed: 2 };
  expFilterEnabled = saved.enabled;
  expFilterMaxAllowed = saved.maxAllowed;

  chkExpFilter.checked = expFilterEnabled;
  expFilterBox.classList.toggle("active", expFilterEnabled);
  expChipsRow.classList.toggle("disabled", !expFilterEnabled);
  updateActiveChip(expFilterMaxAllowed);
  expHintVal.textContent = expFilterMaxAllowed;
});

// Toggle enable/disable
chkExpFilter.addEventListener("change", () => {
  expFilterEnabled = chkExpFilter.checked;
  expFilterBox.classList.toggle("active", expFilterEnabled);
  expChipsRow.classList.toggle("disabled", !expFilterEnabled);
  saveAndBroadcast();
});

// Chip click — select max allowed experience
chips.forEach(chip => {
  chip.addEventListener("click", () => {
    if (!expFilterEnabled) return; // ignore if filter is off
    expFilterMaxAllowed = parseInt(chip.dataset.val, 10);
    updateActiveChip(expFilterMaxAllowed);
    expHintVal.textContent = expFilterMaxAllowed;
    saveAndBroadcast();
  });
});

function updateActiveChip(val) {
  chips.forEach(chip => {
    chip.classList.toggle("active", parseInt(chip.dataset.val, 10) === val);
  });
}

function saveAndBroadcast() {
  const prefs = { enabled: expFilterEnabled, maxAllowed: expFilterMaxAllowed };
  chrome.storage.local.set({ expFilter: prefs }, () => {
    // Tell the active Naukri tab to re-apply the filter immediately
    // Guard against content script not being injected yet
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && /naukri\.com/.test(tabs[0].url)) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "expFilterChanged", enabled: expFilterEnabled, maxAllowed: expFilterMaxAllowed },
          () => { void chrome.runtime.lastError; } // suppress "no receiver" error
        );
      }
    });
  });
}

// ── History ───────────────────────────────────────────────────────────────────

loadHistory();

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear all history?")) return;
  chrome.runtime.sendMessage({ action: "clearHistory" }, () => loadHistory());
});

function loadHistory() {
  chrome.runtime.sendMessage({ action: "getHistory" }, (response) => {
    const jobs = response?.jobs || [];
    historyList.innerHTML = "";

    if (jobs.length === 0) {
      historyList.innerHTML = '<div class="empty-history">No history yet</div>';
      return;
    }

    jobs.forEach((job) => {
      const item = document.createElement("div");
      item.className = "history-item";

      const date = new Date(job.firstSeen).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric",
      });

      item.innerHTML = `
        <div class="history-item-text">
          <div class="history-company">${job.company}</div>
          <div class="history-position">${job.position || "—"}</div>
          <div class="history-date">${date}</div>
        </div>
        <button class="del-btn" title="Remove">×</button>
      `;

      item.querySelector(".del-btn").addEventListener("click", () => {
        chrome.runtime.sendMessage(
          { action: "deleteEntry", company: job.company, position: job.position },
          () => loadHistory()
        );
      });

      historyList.appendChild(item);
    });
  });
}
