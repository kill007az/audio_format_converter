import os
import io
import re
import uuid
import time
import zipfile
import threading
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# Token -> file path mapping with expiry
tokens = {}
TOKEN_EXPIRY = 300  # 5 minutes

# Active jobs: job_id -> { status, title, url, progress, cancel_flag, ... }
jobs = {}
jobs_lock = threading.Lock()

# yt-dlp is not thread-safe (shared player/JS-interpreter caches), so
# concurrent extract_info calls deadlock or hang. Serialize them.
ytdlp_lock = threading.Lock()


def cleanup_expired():
    """Remove expired tokens and their files every 60s."""
    while True:
        time.sleep(60)
        now = time.time()
        expired = [t for t, info in tokens.items() if now > info["expires"]]
        for t in expired:
            path = tokens.pop(t, {}).get("path")
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        # Clean finished/cancelled jobs older than 60s
        with jobs_lock:
            stale = [jid for jid, j in jobs.items()
                     if j["status"] in ("done", "error", "cancelled")
                     and now - j.get("finished_at", now) > 60]
            for jid in stale:
                jobs.pop(jid, None)


threading.Thread(target=cleanup_expired, daemon=True).start()

# Stats tracking
stats = {"conversions": 0, "errors": 0, "start_time": None}

# Auto-shutdown: track last activity time
IDLE_TIMEOUT = 180  # 3 minutes
last_activity = time.time()
activity_lock = threading.Lock()


def touch_activity():
    """Reset the idle timer."""
    global last_activity
    with activity_lock:
        last_activity = time.time()


def auto_shutdown_watcher():
    """Shut down server after IDLE_TIMEOUT seconds of no activity."""
    global last_activity
    while True:
        time.sleep(10)
        with activity_lock:
            idle = time.time() - last_activity

        # Don't shut down if there are active conversions
        with jobs_lock:
            active = any(j["status"] in ("converting", "queued") for j in jobs.values())

        if active:
            touch_activity()
            continue

        remaining = IDLE_TIMEOUT - idle
        if remaining <= 0:
            print(f"\n  [AUTO-SHUTDOWN] No activity for {IDLE_TIMEOUT}s. Shutting down...")
            os._exit(0)
        elif remaining <= 30 and int(remaining) % 10 == 0:
            print(f"  [IDLE] Shutting down in {int(remaining)}s (convert something to stay alive)")


def status_heartbeat():
    """Print server status every 30 seconds."""
    while True:
        time.sleep(30)
        uptime = int(time.time() - stats["start_time"])
        mins, secs = divmod(uptime, 60)
        hrs, mins = divmod(mins, 60)
        active = sum(1 for j in jobs.values() if j["status"] == "converting")
        ready = sum(1 for t in tokens.values() if time.time() < t["expires"])
        print(f"  [STATUS] Uptime: {hrs:02d}h {mins:02d}m {secs:02d}s | "
              f"Conversions: {stats['conversions']} | "
              f"Errors: {stats['errors']} | "
              f"Active: {active} | "
              f"Ready: {ready}")


def run_conversion(job_id, video_url, token, output_path):
    """Run yt-dlp conversion in a background thread."""
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(DOWNLOAD_DIR, f"{token}.%(ext)s"),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "quiet": True,
        "no_warnings": True,
        # If the URL carries a `list=` param (e.g. an auto-generated
        # "radio" mix like list=RD...), yt-dlp will otherwise try to
        # enumerate the entire — sometimes infinite — playlist and hang.
        "noplaylist": True,
    }

    try:
        with jobs_lock:
            if jobs[job_id]["status"] == "cancelled":
                print(f"  [CONVERT] Cancelled before start: {job_id}")
                return
            jobs[job_id]["status"] = "queued"

        with ytdlp_lock:
            with jobs_lock:
                if jobs[job_id]["status"] == "cancelled":
                    print(f"  [CONVERT] Cancelled while queued: {job_id}")
                    return
                jobs[job_id]["status"] = "converting"
                jobs[job_id]["started_at"] = time.time()

            print(f"  [CONVERT] Starting: {video_url}")
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
                title = info.get("title", "audio")

        # Check if cancelled during download
        with jobs_lock:
            if jobs[job_id]["status"] == "cancelled":
                print(f"  [CONVERT] Cancelled during download: {job_id}")
                if os.path.exists(output_path):
                    os.remove(output_path)
                return

        if not os.path.exists(output_path):
            with jobs_lock:
                jobs[job_id]["status"] = "error"
                jobs[job_id]["error"] = "MP3 file not created"
                jobs[job_id]["finished_at"] = time.time()
            stats["errors"] += 1
            print(f"  [CONVERT] Failed: MP3 not created for {job_id}")
            return

        tokens[token] = {
            "path": output_path,
            "title": title,
            "expires": time.time() + TOKEN_EXPIRY,
        }

        with jobs_lock:
            jobs[job_id]["status"] = "done"
            jobs[job_id]["title"] = title
            jobs[job_id]["download_url"] = f"http://localhost:5000/download?token={token}"
            jobs[job_id]["finished_at"] = time.time()

        stats["conversions"] += 1
        print(f"  [CONVERT] Done: {title}")

    except Exception as e:
        with jobs_lock:
            if jobs[job_id]["status"] != "cancelled":
                jobs[job_id]["status"] = "error"
                jobs[job_id]["error"] = str(e)
                jobs[job_id]["finished_at"] = time.time()
        stats["errors"] += 1
        print(f"  [CONVERT] Failed: {e}")


@app.route("/convert", methods=["POST"])
def convert():
    touch_activity()
    data = request.get_json(silent=True) or {}
    video_url = data.get("url", "").strip()

    if not video_url:
        return jsonify({"error": "Missing 'url' parameter"}), 400

    if not any(h in video_url for h in ["youtube.com", "youtu.be"]):
        return jsonify({"error": "Not a YouTube URL"}), 400

    job_id = uuid.uuid4().hex[:12]
    token = uuid.uuid4().hex[:16]
    output_path = os.path.join(DOWNLOAD_DIR, f"{token}.mp3")

    with jobs_lock:
        jobs[job_id] = {
            "status": "converting",
            "url": video_url,
            "title": "Fetching...",
            "started_at": time.time(),
            "token": token,
        }

    thread = threading.Thread(
        target=run_conversion,
        args=(job_id, video_url, token, output_path),
        daemon=True,
    )
    thread.start()

    return jsonify({"job_id": job_id, "status": "converting"})


@app.route("/jobs", methods=["GET"])
def list_jobs():
    """Return all active and recent jobs."""
    with jobs_lock:
        result = []
        for jid, j in jobs.items():
            entry = {
                "job_id": jid,
                "status": j["status"],
                "title": j.get("title", "Fetching..."),
                "url": j.get("url", ""),
            }
            if j["status"] in ("converting", "queued"):
                entry["elapsed"] = int(time.time() - j["started_at"])
            if j["status"] == "done":
                entry["download_url"] = j.get("download_url")
                entry["token"] = j.get("token")
            if j["status"] == "error":
                entry["error"] = j.get("error", "Unknown error")
            result.append(entry)
    return jsonify(result)


@app.route("/cancel", methods=["POST"])
def cancel():
    data = request.get_json(silent=True) or {}
    job_id = data.get("job_id", "").strip()

    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        if job["status"] not in ("converting", "queued"):
            return jsonify({"error": f"Job is already {job['status']}"}), 400

        job["status"] = "cancelled"
        job["finished_at"] = time.time()
        token = job.get("token")

    # Clean up any partial file
    if token:
        partial = os.path.join(DOWNLOAD_DIR, f"{token}.mp3")
        if os.path.exists(partial):
            try:
                os.remove(partial)
            except OSError:
                pass

    print(f"  [CANCEL] Job {job_id} cancelled")
    return jsonify({"status": "cancelled", "job_id": job_id})


@app.route("/download", methods=["GET"])
def download():
    touch_activity()
    token = request.args.get("token", "")
    info = tokens.get(token)

    if not info:
        return jsonify({"error": "Invalid or expired token"}), 404

    if time.time() > info["expires"]:
        tokens.pop(token, None)
        return jsonify({"error": "Token expired"}), 410

    path = info["path"]
    if not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404

    filename = f"{info['title']}.mp3"
    return send_file(path, as_attachment=True, download_name=filename)


@app.route("/download-zip", methods=["POST"])
def download_zip():
    """Bundle multiple completed tokens into a single zip."""
    touch_activity()
    data = request.get_json(silent=True) or {}
    token_list = data.get("tokens", [])

    if not token_list:
        return jsonify({"error": "No tokens provided"}), 400

    def _safe_name(name):
        # Strip path separators and characters illegal on Windows so that
        # arcnames don't accidentally create folders or collide.
        cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name).strip(" .") or "track"
        return cleaned[:150]

    buf = io.BytesIO()
    added = 0
    used_names = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for t in token_list:
            info = tokens.get(t)
            if not info:
                continue
            if time.time() > info["expires"]:
                continue
            path = info["path"]
            if not os.path.exists(path):
                continue
            base = _safe_name(info["title"])
            filename = f"{base}.mp3"
            # De-duplicate so identical/sanitized-equal titles don't overwrite
            n = 1
            while filename in used_names:
                n += 1
                filename = f"{base} ({n}).mp3"
            used_names.add(filename)
            zf.write(path, filename)
            added += 1

    if added == 0:
        return jsonify({"error": "No valid files to zip"}), 404

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="yt-mp3-downloads.zip",
    )


@app.route("/clear-jobs", methods=["POST"])
def clear_jobs():
    """Clear all finished jobs and their files."""
    touch_activity()
    with jobs_lock:
        to_remove = [jid for jid, j in jobs.items()
                     if j["status"] in ("done", "error", "cancelled")]
        for jid in to_remove:
            job = jobs.pop(jid)
            token = job.get("token")
            if token:
                info = tokens.pop(token, None)
                if info and os.path.exists(info.get("path", "")):
                    try:
                        os.remove(info["path"])
                    except OSError:
                        pass
    print(f"  [CLEAR] Removed {len(to_remove)} jobs")
    return jsonify({"cleared": len(to_remove)})


@app.route("/shutdown", methods=["POST"])
def shutdown():
    """Gracefully shut down the server from the extension."""
    print(f"\n  [SHUTDOWN] Shutdown requested from extension.")
    # Respond before dying
    def die():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=die, daemon=True).start()
    return jsonify({"status": "shutting-down"})


@app.route("/health", methods=["GET"])
def health():
    touch_activity()
    with activity_lock:
        idle = int(time.time() - last_activity)
    return jsonify({"status": "ok", "idle": idle, "shutdown_in": max(0, IDLE_TIMEOUT - idle)})


if __name__ == "__main__":
    stats["start_time"] = time.time()
    touch_activity()
    threading.Thread(target=status_heartbeat, daemon=True).start()
    threading.Thread(target=auto_shutdown_watcher, daemon=True).start()
    print("=" * 50)
    print("  YT-MP3 Local Server running on :5000")
    print("  Auto-shutdown after 3 min of inactivity")
    print("  Status updates every 30 seconds")
    print("=" * 50)
    app.run(host="127.0.0.1", port=5000, debug=False)
