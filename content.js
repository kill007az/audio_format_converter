(() => {
  let downloadButtonInjected = false;
  let observer = null;

  // Listen for messages from background script (context menu clicks)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "start-download") {
      triggerDownload(message.videoId, message.videoUrl);
    }
  });

  // Main observer — watches for navigation / DOM changes on YouTube (SPA)
  function init() {
    injectDownloadButton();

    observer = new MutationObserver(() => {
      if (isWatchPage() && !downloadButtonInjected) {
        injectDownloadButton();
      }
      if (!isWatchPage()) {
        downloadButtonInjected = false;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // YouTube uses History API for navigation
    window.addEventListener("yt-navigate-finish", () => {
      downloadButtonInjected = false;
      setTimeout(injectDownloadButton, 500);
    });
  }

  function isWatchPage() {
    return location.pathname === "/watch";
  }

  // ── Inject download button below the video player ──
  function injectDownloadButton() {
    if (!isWatchPage()) return;
    if (document.getElementById("yt-mp3-download-btn")) {
      downloadButtonInjected = true;
      return;
    }

    // Target: the actions row under the video title
    const target = document.querySelector(
      "#top-level-buttons-computed, ytd-menu-renderer.ytd-watch-metadata #top-level-buttons-computed"
    );

    if (!target) {
      // Retry — YouTube loads elements lazily
      setTimeout(injectDownloadButton, 1000);
      return;
    }

    const btn = document.createElement("button");
    btn.id = "yt-mp3-download-btn";
    btn.className = "yt-mp3-btn";
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-5H7l5-6 5 6h-4v5h-2z" transform="rotate(180 12 12)"/>
      </svg>
      <span>Download MP3</span>
    `;
    btn.addEventListener("click", () => {
      const videoId = new URLSearchParams(location.search).get("v");
      if (videoId) {
        triggerDownload(videoId, location.href);
      }
    });

    target.appendChild(btn);
    downloadButtonInjected = true;
  }

  // ── Download flow ──
  async function triggerDownload(videoId, videoUrl) {
    showToast("Starting conversion...", "loading");

    try {
      // Step 1: Start the conversion job
      const result = await sendMsg({ action: "convert-to-mp3", videoId, videoUrl });

      if (result.error) throw new Error(result.error);

      if (!result.job_id) throw new Error("No job ID returned");

      showToast("Converting to MP3...", "loading");

      // Step 2: Poll for job completion
      const job = await pollJob(result.job_id);

      if (job.status === "done") {
        showToast(`"${job.title}" is done — click here to download`, "success", () => {
          chrome.runtime.sendMessage({ action: "open-popup" });
        });
      } else if (job.status === "error") {
        showToast(`Error: ${job.error || "Conversion failed"}`, "error");
      } else if (job.status === "cancelled") {
        showToast("Conversion cancelled.", "info");
      }
    } catch (err) {
      console.error("YT-MP3:", err);
      showToast(`Error: ${err.message}`, "error");
    }
  }

  function sendMsg(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response || {});
        }
      });
    });
  }

  async function pollJob(jobId, timeout = 300000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const jobs = await sendMsg({ action: "get-jobs" });
      if (Array.isArray(jobs)) {
        const job = jobs.find(j => j.job_id === jobId);
        if (job) {
          if (job.status === "converting") {
            showToast(`Converting... ${job.elapsed || 0}s`, "loading");
          } else {
            return job;
          }
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error("Conversion timed out");
  }

  // ── Toast notification ──
  function showToast(message, type = "info", onClick = null) {
    const existing = document.getElementById("yt-mp3-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "yt-mp3-toast";
    toast.className = `yt-mp3-toast yt-mp3-toast--${type}`;

    if (type === "loading") {
      toast.innerHTML = `<div class="yt-mp3-spinner"></div><span>${message}</span>`;
    } else if (onClick) {
      toast.innerHTML = `<span>${message}</span>`;
      toast.style.cursor = "pointer";
      toast.style.textDecoration = "underline";
      toast.addEventListener("click", () => {
        onClick();
        toast.remove();
      });
    } else {
      toast.textContent = message;
    }

    document.body.appendChild(toast);

    if (type !== "loading") {
      setTimeout(() => toast.remove(), 8000);
    }
  }

  // Kick off when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
