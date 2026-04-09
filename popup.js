const urlInput = document.getElementById("url-input");
const convertBtn = document.getElementById("convert-btn");
const statusEl = document.getElementById("status");
const jobsList = document.getElementById("jobs-list");
const serverDot = document.getElementById("server-dot");
const serverLabel = document.getElementById("server-label");
const killBtn = document.getElementById("btn-server-kill");
const bulkActions = document.getElementById("bulk-actions");
const saveAllBtn = document.getElementById("btn-save-all");
const clearBtn = document.getElementById("btn-clear");
const closeWindowBtn = document.getElementById("btn-close-window");

// Detect if we're in a popup-window (vs the regular toolbar popup)
const isWindowMode = new URLSearchParams(location.search).get("window") === "true";
if (isWindowMode) {
  document.body.classList.add("window-mode");
  closeWindowBtn.classList.add("visible");
  closeWindowBtn.addEventListener("click", () => window.close());
}

let pollInterval = null;
let serverOnline = false;
let cachedJobs = []; // Store latest jobs for bulk actions

// ── Auto-fill from current tab ──
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (tab?.url && isYouTubeUrl(tab.url)) {
    urlInput.value = tab.url;
  }
});

// ── Kill server button ──
killBtn.addEventListener("click", () => {
  killBtn.disabled = true;
  killBtn.textContent = "...";
  chrome.runtime.sendMessage({ action: "shutdown-server" }, () => {
    setServerStatus(false);
    killBtn.disabled = false;
    killBtn.textContent = "Kill";
    jobsList.innerHTML = `<div class="no-jobs">Server stopped</div>`;
    bulkActions.className = "bulk-actions";
  });
});

// ── Convert button ──
convertBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) return showStatus("Please enter a YouTube URL.", "error");
  if (!isYouTubeUrl(url)) return showStatus("Not a valid YouTube URL.", "error");
  if (!extractVideoId(url)) return showStatus("Could not extract video ID.", "error");
  startConversion(url);
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") convertBtn.click();
});

async function startConversion(videoUrl) {
  convertBtn.disabled = true;
  showStatus("Sending to server...", "loading");

  chrome.runtime.sendMessage({ action: "convert-to-mp3", videoUrl }, (response) => {
    convertBtn.disabled = false;
    if (chrome.runtime.lastError) {
      showStatus(`Error: ${chrome.runtime.lastError.message}`, "error");
      return;
    }
    if (response?.error) {
      showStatus(`Error: ${response.error}`, "error");
      return;
    }
    showStatus("Conversion started!", "success");
    refreshJobs();
  });
}

// ── Save individual file (with explorer dialog) ──
function saveFile(downloadUrl, title) {
  const filename = `${sanitizeFilename(title)}.mp3`;
  chrome.runtime.sendMessage({
    action: "save-file",
    url: downloadUrl,
    filename: filename,
  });
}

// ── Save All as zip ──
saveAllBtn.addEventListener("click", async () => {
  const doneJobs = cachedJobs.filter(j => j.status === "done" && j.token);
  if (doneJobs.length === 0) return;

  const tokens = doneJobs.map(j => j.token);
  saveAllBtn.disabled = true;
  saveAllBtn.textContent = "Zipping...";

  try {
    const response = await fetch("http://localhost:5000/download-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    // Convert to a data URL so the download survives the popup closing
    // when the Save As dialog opens (blob: URLs from popup context get
    // revoked the moment the popup unloads, producing an empty file).
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    await chrome.downloads.download({
      url: dataUrl,
      filename: "yt-mp3-downloads.zip",
      saveAs: true,
    });
  } catch (err) {
    showStatus(`Zip error: ${err.message}`, "error");
  } finally {
    saveAllBtn.disabled = false;
    saveAllBtn.textContent = "Save All (.zip)";
  }
});

// ── Clear list ──
clearBtn.addEventListener("click", () => {
  clearBtn.disabled = true;
  clearBtn.textContent = "Clearing...";
  chrome.runtime.sendMessage({ action: "clear-jobs" }, () => {
    clearBtn.disabled = false;
    clearBtn.textContent = "Clear List";
    refreshJobs();
  });
});

// ── Cancel a job ──
function cancelJob(jobId) {
  chrome.runtime.sendMessage({ action: "cancel-job", jobId }, () => refreshJobs());
}

// ── Poll jobs from server ──
function refreshJobs() {
  chrome.runtime.sendMessage({ action: "get-jobs" }, (response) => {
    if (chrome.runtime.lastError || response?.error) {
      setServerStatus(false);
      jobsList.innerHTML = `<div class="no-jobs">Server offline</div>`;
      bulkActions.className = "bulk-actions";
      return;
    }

    setServerStatus(true);

    if (!Array.isArray(response) || response.length === 0) {
      cachedJobs = [];
      jobsList.innerHTML = `<div class="no-jobs">No active conversions</div>`;
      bulkActions.className = "bulk-actions";
      return;
    }

    cachedJobs = response;

    // Sort: converting first, then queued, done, errors
    const order = { converting: 0, queued: 1, done: 2, error: 3, cancelled: 4 };
    response.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    const doneCount = response.filter(j => j.status === "done").length;

    jobsList.innerHTML = response.map(job => {
      const title = job.title || "Unknown";
      const truncTitle = title.length > 32 ? title.substring(0, 32) + "..." : title;

      let meta = "";
      let actions = "";

      if (job.status === "converting") {
        meta = `${job.elapsed || 0}s elapsed`;
        actions = `<button class="btn-small btn-stop" data-cancel="${job.job_id}">Stop</button>`;
      } else if (job.status === "queued") {
        meta = "Waiting in queue...";
        actions = `<button class="btn-small btn-stop" data-cancel="${job.job_id}">Stop</button>`;
      } else if (job.status === "done") {
        meta = "Ready to save";
        actions = `<button class="btn-small btn-save" data-save-url="${job.download_url}" data-save-title="${escape(job.title)}">Save</button>`;
      } else if (job.status === "error") {
        meta = job.error || "Conversion failed";
      } else if (job.status === "cancelled") {
        meta = "Cancelled";
      }

      return `
        <div class="job-card">
          <div class="job-info">
            <div class="job-title" title="${title}">${truncTitle}</div>
            <div class="job-meta">${meta}</div>
          </div>
          <span class="job-status-badge ${job.status}">${job.status}</span>
          <div class="job-actions">${actions}</div>
        </div>
      `;
    }).join("");

    // Attach event listeners
    jobsList.querySelectorAll("[data-cancel]").forEach(btn => {
      btn.addEventListener("click", () => cancelJob(btn.dataset.cancel));
    });
    jobsList.querySelectorAll("[data-save-url]").forEach(btn => {
      btn.addEventListener("click", () => {
        saveFile(btn.dataset.saveUrl, unescape(btn.dataset.saveTitle));
      });
    });

    // Show/hide bulk actions and update Save All count
    if (response.length > 0) {
      bulkActions.className = "bulk-actions visible";
      saveAllBtn.textContent = doneCount > 0 ? `Save All (${doneCount} .zip)` : "Save All (.zip)";
      saveAllBtn.disabled = doneCount === 0;
    } else {
      bulkActions.className = "bulk-actions";
    }
  });
}

// ── Helpers ──
function setServerStatus(online) {
  serverOnline = online;
  serverDot.className = `server-dot ${online ? "online" : "offline"}`;
  serverLabel.textContent = online ? "Server running" : "Server offline";
  killBtn.className = `btn-server-kill${online ? " visible" : ""}`;
}

function checkHealth() {
  fetch("http://localhost:5000/health")
    .then(r => r.ok ? setServerStatus(true) : setServerStatus(false))
    .catch(() => setServerStatus(false));
}

function showStatus(message, type) {
  statusEl.className = `status ${type}`;
  if (type === "loading") {
    statusEl.innerHTML = `<div class="spinner"></div><span>${message}</span>`;
  } else {
    statusEl.textContent = message;
  }
  if (type !== "loading") {
    setTimeout(() => { statusEl.className = "status"; }, 4000);
  }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_").substring(0, 200);
}

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return ["www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"].includes(u.hostname);
  } catch { return false; }
}

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/shorts/")[1];
    return u.searchParams.get("v");
  } catch { return null; }
}

// ── Start polling ──
checkHealth();
refreshJobs();
pollInterval = setInterval(refreshJobs, 2000);
