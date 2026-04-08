# YouTube to MP3 Downloader

A Chrome extension that converts YouTube videos to high-quality MP3 files using a **fully local** Flask server powered by `yt-dlp` and `ffmpeg`. No third-party APIs, no cloud services, no rate limits — everything runs on your own machine.

---

## Demo

> 📹 [**Demo video**](https://drive.google.com/file/d/1TQS_RvAUm-qISDU4UG0eH7LNiHSOjEeF/view?usp=sharing)
<!-- Replace this line with your demo video link, e.g.:
[![Demo Video](thumbnail_url)](youtube_or_loom_link)
-->

---

## Features

- **Three ways to convert:**
  - Paste any YouTube URL into the extension popup
  - Right-click a YouTube video link/thumbnail → *Download as MP3*
  - Click the injected **Download MP3** button below any playing video

- **Live job tracking panel** — see all conversions in real time with status badges (`converting`, `done`, `error`, `cancelled`)

- **Stop individual jobs** mid-conversion

- **Save individual MP3s** via native Windows Save As dialog

- **Save All as ZIP** — bundle all completed conversions into a single `.zip` and choose where to save

- **Clear List** — remove finished jobs and clean up temp files instantly

- **Auto-start server** — clicking Convert auto-launches the backend in a visible terminal window via Chrome Native Messaging (no manual start needed after one-time setup)

- **Auto-shutdown** — server shuts itself down after **3 minutes of inactivity** (active conversions keep it alive)

- **Kill button** — stop the server from inside the extension popup at any time

- **Window mode** — clicking "click here to download" on the in-page toast opens the extension in a properly scaled popup window with a close button

- **Server health indicator** — green/red dot showing whether the backend is running

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                  Chrome Browser                       │
│                                                       │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────┐  │
│  │ content.js  │    │ background.js│    │ popup.js │  │
│  │ (YouTube    │◄──►│ (service     │◄──►│ (popup   │  │
│  │  page)      │    │  worker)     │    │  UI)     │  │
│  └─────────────┘    └──────┬───────┘    └──────────┘  │
│                            │ Native Messaging         │
└────────────────────────────┼──────────────────────────┘
                             │
                  ┌──────────▼─────────┐
                  │  native_host.py    │
                  │  (launches server  │
                  │   in new terminal) │
                  └─────────┬──────────┘
                            │
                  ┌─────────▼──────────┐
                  │   server.py        │
                  │   Flask :5000      │
                  │                    │
                  │  yt-dlp + ffmpeg   │
                  │  → MP3 @ 192kbps   │
                  └────────────────────┘
```

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| Windows 10/11 | Native Messaging requires Windows registry |
| Chrome (or Chromium) | Manifest V3 |
| [Anaconda / Miniconda](https://docs.conda.io/en/latest/miniconda.html) | For environment management |
| Internet connection | For downloading from YouTube |

> ⚠️ **FFmpeg** is installed automatically inside the conda environment — no separate installation needed.

---

## Installation

### Step 1 — Clone or download the project

```
E:\EAG V3\audio_format_converter\
```

### Step 2 — Create the conda environment

Open **Anaconda Prompt** and run:

```bash
conda create -n yt-mp3-api python=3.10 -y
conda activate yt-mp3-api
pip install flask yt-dlp flask-cors
conda install -c conda-forge ffmpeg -y
```

### Step 3 — Load the Chrome extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `audio_format_converter` folder
5. Copy the **Extension ID** shown on the extension card (looks like `abcdefghijklmnopqrstuvwxyzabcdef`)

### Step 4 — Register the Native Messaging host *(one-time)*

Double-click `install_native_host.bat` and paste your extension ID when prompted.

This registers the host in the Windows registry under `HKCU` (no admin rights needed).

### Step 5 — Restart Chrome

Close and reopen Chrome so it picks up the new native messaging registration.

---

## Usage

### Auto-start (recommended)

After completing the one-time setup, just use the extension — it will **automatically launch the server** in a new terminal window when you request a conversion.

### Manual start / stop

| Action | How |
|--------|-----|
| Start server | Double-click `start_server.bat` |
| Stop server | Double-click `stop_server.bat`, or click **Kill** in the popup |
| Server auto-stops | After 3 minutes of no activity |

---

## Extension UI Guide

```
┌─────────────────────────────────────┐
│         YouTube to MP3              │
│  Paste a YouTube link to download   │
├─────────────────────────────────────┤
│  YOUTUBE URL                        │
│  [ https://youtube.com/watch?v=...] │
│                          [Convert]  │
│                                     │
│  CONVERSIONS          ● Server running [Kill]
│  ┌───────────────────────────────┐  │
│  │ Song Title       [DONE] [Save]│  │
│  │ Ready to save                 │  │
│  ├───────────────────────────────┤  │
│  │ Another Song  [CONVERTING][Stop] │
│  │ 12s elapsed                   │  │
│  └───────────────────────────────┘  │
│  [ Save All (2 .zip) ] [Clear List] │
├─────────────────────────────────────┤
│    Powered by yt-dlp · :5000        │
└─────────────────────────────────────┘
```

### Buttons

| Button | Action |
|--------|--------|
| **Convert** | Start a new conversion from the URL input |
| **Save** | Opens Windows Save As dialog for one MP3 |
| **Stop** | Cancels an in-progress conversion |
| **Save All (.zip)** | Bundles all completed MP3s into a ZIP, opens Save As dialog |
| **Clear List** | Removes all finished jobs and deletes temp files |
| **Kill** | Shuts down the local server immediately |

---

## File Structure

```
audio_format_converter/
│
├── manifest.json              # Chrome extension manifest (v3)
├── background.js              # Service worker — message routing, server management
├── content.js                 # Injected into YouTube — button + toast notifications
├── content.css                # Styles for injected button and toasts
├── popup.html                 # Extension popup UI
├── popup.js                   # Popup logic — jobs, bulk actions, health polling
│
├── server.py                  # Flask backend server (localhost:5000)
├── native_host.py             # Chrome Native Messaging host
├── native_host.bat            # Wrapper to invoke native_host.py
├── native_host_manifest.json  # Native messaging manifest (generated by installer)
│
├── start_server.bat           # Manually start the server
├── stop_server.bat            # Manually kill the server
├── install_native_host.bat    # One-time setup — registers native host in registry
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── downloads/                 # Temp MP3 storage (auto-cleaned)
```

---

## API Reference

The Flask server exposes the following endpoints on `http://localhost:5000`:

| Endpoint | Method | Body / Params | Description |
|----------|--------|---------------|-------------|
| `/health` | GET | — | Server status, idle time, shutdown countdown |
| `/convert` | POST | `{"url": "..."}` | Start a conversion; returns `job_id` |
| `/jobs` | GET | — | All active and recent jobs |
| `/cancel` | POST | `{"job_id": "..."}` | Cancel an in-progress conversion |
| `/download` | GET | `?token=...` | Download a completed MP3 |
| `/download-zip` | POST | `{"tokens": [...]}` | Download multiple MP3s as a ZIP |
| `/clear-jobs` | POST | — | Remove all finished jobs and temp files |
| `/shutdown` | POST | — | Gracefully shut down the server |

---

## Job Lifecycle

```
User submits URL
       │
       ▼
  [converting] ──────────────────────────► [cancelled]
  "Fetching..."        (user stops)
       │
  yt-dlp downloads + ffmpeg encodes
       │
  ┌────┴────┐
  ▼         ▼
[done]    [error]
  │
  │  Token valid for 5 minutes
  │  File stays in downloads/
  ▼
User saves MP3 or ZIP
       │
       ▼
  Job cleared (manual or auto after 60s)
  File deleted
```

---

## Terminal Output

When the server is running you'll see live output:

```
==================================================
  YT-MP3 Local Server running on :5000
  Auto-shutdown after 3 min of inactivity
  Status updates every 30 seconds
==================================================
  [CONVERT] Starting: https://www.youtube.com/watch?v=...
  [CONVERT] Done: Never Gonna Give You Up
  [STATUS] Uptime: 00h 02m 30s | Conversions: 3 | Errors: 0 | Active: 0 | Ready: 2
  [IDLE] Shutting down in 20s (convert something to stay alive)
  [AUTO-SHUTDOWN] No activity for 180s. Shutting down...
```

---

## System Resource Usage

| Resource | Idle | During conversion |
|----------|------|-------------------|
| RAM | ~20–30 MB | ~50–100 MB |
| CPU | ~0% | Brief spike (ffmpeg encoding) |
| Disk | ~0 MB | ~3–8 MB per track (auto-cleaned) |
| Network | 0 | Same as watching the video |

**Total install size:** ~250 MB (conda environment with ffmpeg)

**Cost:** $0 — fully local, no API keys, no rate limits.

---

## Troubleshooting

### "Could not auto-start server"
Run `install_native_host.bat` again and make sure the extension ID matches exactly. Restart Chrome after installing.

### Server starts but conversion fails
- Make sure the conda env `yt-mp3-api` exists with all dependencies
- Check the server terminal for error details
- Try running `start_server.bat` manually to see full output

### Right-click option doesn't appear on thumbnails
The context menu only appears when right-clicking **links** (anchor elements) that point to YouTube watch/shorts URLs, not on every thumbnail image.

### "Token expired" when trying to download
Completed files are only kept for 5 minutes. Start a new conversion if the token has expired.

### Native messaging not working after Chrome update
Re-run `install_native_host.bat` — the registry entry may need refreshing.

---

## Removing the Extension

1. Remove from Chrome: `chrome://extensions` → Remove
2. Delete registry entry:
   ```
   reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytmp3.server" /f
   ```
3. Remove conda environment:
   ```bash
   conda env remove -n yt-mp3-api
   ```
4. Delete the project folder

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Extension | Chrome Manifest V3, Vanilla JS |
| Backend | Python 3.10, Flask, Flask-CORS |
| Downloader | yt-dlp |
| Audio encoder | FFmpeg (via conda-forge) |
| Environment | Conda (`yt-mp3-api`) |
| Native bridge | Chrome Native Messaging |

---

## License

MIT — free to use, modify, and distribute.
