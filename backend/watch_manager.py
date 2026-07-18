"""
Channel-watching module for YT-PLAYLIST-VIDEOS-DOWNLOADER.
 
Adds:
  POST   /api/watch/add          -> start watching a channel/playlist URL
  GET    /api/watch/list         -> list all watched entries + status
  DELETE /api/watch/<watch_id>   -> stop watching
  POST   /api/watch/tick         -> run one check-and-download pass (for cron / external pinger)
 
Reuses app.py's QUALITY_MAP, sanitize_filename, and DOWNLOAD_ROOT so behavior
(quality choice, folder naming) stays identical to manual downloads.
 
Each watched entry gets its own yt-dlp `download_archive` file, so re-running
a check only ever downloads videos it hasn't seen before -- no manual diffing.
"""
import os
import json
import threading
import uuid
import time
 
from flask import Blueprint, request, jsonify
import yt_dlp
 
watch_bp = Blueprint("watch_bp", __name__)
 
DATA_DIR = os.path.join(os.getcwd(), "watch_data")
WATCH_FILE = os.path.join(DATA_DIR, "watched_channels.json")
watch_lock = threading.Lock()
 
 
def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(WATCH_FILE):
        with open(WATCH_FILE, "w") as f:
            json.dump([], f)
 
 
def _load_watches():
    _ensure_data_dir()
    with open(WATCH_FILE, "r") as f:
        return json.load(f)
 
 
def _save_watches(watches):
    with open(WATCH_FILE, "w") as f:
        json.dump(watches, f, indent=2)
 
 
def _init(app_module):
    """Called once from app.py to hand over shared helpers (avoids circular import)."""
    global sanitize_filename, QUALITY_MAP, DOWNLOAD_ROOT
    sanitize_filename = app_module.sanitize_filename
    QUALITY_MAP = app_module.QUALITY_MAP
    DOWNLOAD_ROOT = app_module.DOWNLOAD_ROOT
 
 
SEED_COUNT = 10  # how many *existing* recent videos to mark as "already known" on add
 
 
def _seed_archive(url, archive_path):
    """Records the IDs of videos that already exist on the channel right now,
    WITHOUT downloading them. This is what makes watching start from 'now':
    anything posted before you added the watch is marked as already-seen,
    so only videos uploaded after this moment ever count as new."""
    ydl_opts = {
        "quiet": True,
        "extract_flat": True,
        "skip_download": True,
        "playlist_items": f"1-{SEED_COUNT}",
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
 
    entries = info.get("entries") if info.get("entries") is not None else [info]
    entries = [e for e in entries if e]
 
    with open(archive_path, "a") as f:
        for e in entries:
            vid = e.get("id")
            if vid:
                f.write(f"youtube {vid}\n")
 
    return len(entries)
 
 
@watch_bp.route("/api/watch/add", methods=["POST"])
def watch_add():
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or "").strip()
    quality = data.get("quality") or "4"
 
    if not url:
        return jsonify({"error": "Channel or playlist URL is required."}), 400
 
    watch_id = uuid.uuid4().hex[:9]
    archive_path = os.path.join(DATA_DIR, f"archive_{watch_id}.txt")
    open(archive_path, "a").close()  # create empty archive file
 
    try:
        seeded = _seed_archive(url, archive_path)
    except Exception as e:
        return jsonify({"error": f"Could not read channel: {e}"}), 502
 
    entry = {
        "id": watch_id,
        "url": url,
        "quality": quality,
        "archivePath": archive_path,
        "createdAt": time.time(),
        "lastCheckedAt": None,
        "lastNewVideos": [],
        "totalDownloaded": 0,
        "lastError": None,
        "seededExisting": seeded,
    }
 
    with watch_lock:
        watches = _load_watches()
        watches.append(entry)
        _save_watches(watches)
 
    return jsonify(entry)
 
 
@watch_bp.route("/api/watch/list", methods=["GET"])
def watch_list():
    with watch_lock:
        watches = _load_watches()
    return jsonify(watches)
 
 
@watch_bp.route("/api/watch/<watch_id>", methods=["DELETE"])
def watch_delete(watch_id):
    with watch_lock:
        watches = _load_watches()
        remaining = [w for w in watches if w["id"] != watch_id]
        if len(remaining) == len(watches):
            return jsonify({"error": "Watch id not found."}), 404
        _save_watches(remaining)
    return jsonify({"deleted": watch_id})
 
 
RECENT_WINDOW = 5  # only ever look at the latest N uploads per check
 
 
import subprocess
 
RCLONE_REMOTE = "gdrive:YT-AutoDownloads"  # matches the folder created earlier
 
 
def _sync_to_drive(local_folder, dest_subfolder):
    """Moves newly downloaded files from local disk to Google Drive.
    Uses 'rclone move' (not 'copy') so files are removed locally once
    uploaded -- this matters because hosting platforms like Render use
    ephemeral disks that can be wiped on restart/redeploy."""
    dest = f"{RCLONE_REMOTE}/{dest_subfolder}"
    try:
        result = subprocess.run(
            ["./rclone", "move", local_folder, dest, "--delete-empty-src-dirs"],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            return f"rclone error: {result.stderr.strip()[:300]}"
        return None
    except FileNotFoundError:
        return "rclone not found on PATH -- files stayed local, not uploaded."
    except subprocess.TimeoutExpired:
        return "rclone upload timed out after 10 minutes."
 
 
def _check_one(entry):
    """Runs yt-dlp against one watched URL, using its own archive file.
    Only the latest RECENT_WINDOW uploads are even considered each run --
    this avoids backfilling a channel's entire history (some have 900+
    videos) and matches the "watch for upcoming videos" use case: we only
    care about what's new since last check, not the full back-catalog.
    Anything already in the archive is skipped automatically by yt-dlp."""
    _, fmt_string = QUALITY_MAP.get(entry["quality"], QUALITY_MAP["4"])
    folder = os.path.join(DOWNLOAD_ROOT, f"watched_{entry['id']}")
    os.makedirs(folder, exist_ok=True)
 
    new_titles = []
    seen_ids = set()
 
    def hook(d):
        if d["status"] == "finished":
            info = d.get("info_dict") or {}
            vid = info.get("id")
            if vid and vid in seen_ids:
                return  # video+audio streams both fire 'finished' -- count once
            if vid:
                seen_ids.add(vid)
            new_titles.append(info.get("title") or "Untitled video")
 
    ydl_opts = {
        "format": fmt_string,
        "merge_output_format": "mp4",
        "outtmpl": os.path.join(folder, "%(upload_date)s - %(title)s.%(ext)s"),
        "download_archive": entry["archivePath"],
        "playlist_items": f"1-{RECENT_WINDOW}",
        "quiet": False,
        "noprogress": False,
        "ignoreerrors": True,
        "socket_timeout": 30,
        "progress_hooks": [hook],
    }
 
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([entry["url"]])
 
    sync_error = None
    if new_titles:  # only bother syncing if something new actually downloaded
        sync_error = _sync_to_drive(folder, entry["id"])
 
    entry["lastCheckedAt"] = time.time()
    entry["lastNewVideos"] = new_titles
    entry["totalDownloaded"] = entry.get("totalDownloaded", 0) + len(new_titles)
    entry["lastError"] = sync_error  # None if sync succeeded (or nothing new to sync)
    return entry
 
 
@watch_bp.route("/api/watch/tick", methods=["POST"])
def watch_tick():
    """Trigger one check-and-download pass across every watched entry.
    Call this from an external scheduler (cron-job.org, cron, Task Scheduler)."""
    with watch_lock:
        watches = _load_watches()
 
    results = []
    for entry in watches:
        try:
            updated = _check_one(entry)
        except Exception as e:
            entry["lastError"] = str(e)
            entry["lastCheckedAt"] = time.time()
            updated = entry
        results.append(updated)
 
    with watch_lock:
        _save_watches(results)
 
    summary = {
        "checked": len(results),
        "newVideosFound": sum(len(r["lastNewVideos"]) for r in results),
        "results": results,
    }
    return jsonify(summary)