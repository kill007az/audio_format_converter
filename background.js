const LOCAL_API = "http://localhost:5000";
const NATIVE_HOST = "com.ytmp3.server";

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "download-mp3",
    title: "Download as MP3",
    contexts: ["link"],
    targetUrlPatterns: [
      "https://www.youtube.com/watch*",
      "https://youtube.com/watch*",
      "https://www.youtube.com/shorts/*",
      "https://youtube.com/shorts/*",
      "https://youtu.be/*"
    ]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "download-mp3") {
    const videoUrl = info.linkUrl;
    const videoId = extractVideoId(videoUrl);
    if (videoId) {
      chrome.tabs.sendMessage(tab.id, {
        action: "start-download",
        videoId: videoId,
        videoUrl: videoUrl
      });
    }
  }
});

// Listen for messages from content script / popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "convert-to-mp3") {
    ensureServerThenConvert(message.videoUrl || `https://www.youtube.com/watch?v=${message.videoId}`)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "get-jobs") {
    getJobs()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "cancel-job") {
    cancelJob(message.jobId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "check-server") {
    isServerRunning()
      .then(running => sendResponse({ running }))
      .catch(() => sendResponse({ running: false }));
    return true;
  }
  if (message.action === "open-popup") {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?window=true"),
      type: "popup",
      width: 460,
      height: 580,
      focused: true,
    });
    return;
  }
  if (message.action === "shutdown-server") {
    shutdownServer()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.action === "save-file") {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename || undefined,
      saveAs: true,
    }, (downloadId) => {
      sendResponse({ downloadId });
    });
    return true;
  }
  // save-all-zip is handled directly in popup.js (needs URL.createObjectURL)
  if (message.action === "clear-jobs") {
    clearJobs()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/shorts/")[1];
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

// ── Server management ──

async function isServerRunning() {
  try {
    const r = await fetch(`${LOCAL_API}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function launchServerViaNativeHost() {
  return new Promise((resolve, reject) => {
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST);
      port.onMessage.addListener((response) => {
        console.log("[YT-MP3] Native host response:", response);
        port.disconnect();
        resolve(response);
      });
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.error("[YT-MP3] Native host error:", err.message);
          reject(new Error(err.message));
        }
      });
      port.postMessage({ action: "start-server" });
    } catch (err) {
      reject(err);
    }
  });
}

async function waitForServer(maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await isServerRunning()) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("Server did not start in time. Run install_native_host.bat first.");
}

async function ensureServerRunning() {
  if (await isServerRunning()) return;

  console.log("[YT-MP3] Server not running, launching via native host...");
  try {
    await launchServerViaNativeHost();
  } catch (err) {
    throw new Error(
      `Could not auto-start server: ${err.message}. ` +
      `Run install_native_host.bat or start_server.bat manually.`
    );
  }
  await waitForServer();
  console.log("[YT-MP3] Server is now running.");
}

// ── API calls ──

async function ensureServerThenConvert(videoUrl) {
  await ensureServerRunning();

  const response = await fetch(`${LOCAL_API}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: videoUrl })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function getJobs() {
  const response = await fetch(`${LOCAL_API}/jobs`);
  if (!response.ok) throw new Error("Failed to fetch jobs");
  return await response.json();
}

async function cancelJob(jobId) {
  const response = await fetch(`${LOCAL_API}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId })
  });
  return await response.json();
}

async function clearJobs() {
  const response = await fetch(`${LOCAL_API}/clear-jobs`, { method: "POST" });
  return await response.json();
}

async function saveAllAsZip(tokens) {
  const response = await fetch(`${LOCAL_API}/download-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Zip failed");
  }

  // Convert the zip blob to a downloadable object URL
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    chrome.downloads.download({
      url: url,
      filename: "yt-mp3-downloads.zip",
      saveAs: true,
    }, (downloadId) => {
      // Clean up the object URL after a delay
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      resolve({ downloadId });
    });
  });
}

async function shutdownServer() {
  const response = await fetch(`${LOCAL_API}/shutdown`, { method: "POST" });
  return await response.json();
}
