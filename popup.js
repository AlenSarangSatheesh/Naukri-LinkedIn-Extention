// popup.js

const historyList = document.getElementById("historyList");
const clearBtn = document.getElementById("clearBtn");

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

// ── Load saved checkbox prefs ─────────────────────────────────────────────────

chrome.storage.local.get(["openPrefs"], (result) => {
  // Default: all three checked
  const prefs = result.openPrefs || { linkedin: true, dork: true, people: true };
  Object.keys(checkboxes).forEach((key) => {
    checkboxes[key].checked = prefs[key] !== false;
    rows[key].classList.toggle("checked", checkboxes[key].checked);
  });
});

// ── Save prefs on change ──────────────────────────────────────────────────────

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

// ── Hide/Mark Toggle ──────────────────────────────────────────────────────────

const hideToggle = document.getElementById("chk-hideApplied");
const toggleLabel = document.getElementById("toggleLabel");
const toggleDesc = document.getElementById("toggleDesc");
const toggleModeText = document.getElementById("toggleModeText");

function updateToggleUI(isHide) {
  if (isHide) {
    toggleLabel.textContent = "🚫 Hide applied jobs";
    toggleDesc.textContent = "Completely hides applied cards from results";
    toggleModeText.textContent = "HIDE MODE";
    toggleModeText.className = "toggle-mode-text hide";
  } else {
    toggleLabel.textContent = "✅ Mark applied jobs";
    toggleDesc.textContent = "Shows green badge on applied cards";
    toggleModeText.textContent = "MARK MODE";
    toggleModeText.className = "toggle-mode-text mark";
  }
}

// Load saved preference
chrome.storage.local.get(["hideApplied"], (result) => {
  const isHide = result.hideApplied === true;
  hideToggle.checked = isHide;
  updateToggleUI(isHide);
});

// Save on change
hideToggle.addEventListener("change", () => {
  const isHide = hideToggle.checked;
  chrome.storage.local.set({ hideApplied: isHide });
  updateToggleUI(isHide);
});

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
