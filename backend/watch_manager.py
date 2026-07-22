"""
Channel-watching module for YT-PLAYLIST-VIDEOS-DOWNLOADER (LOCAL VERSION).
 
Adds:
  POST   /api/watch/add          -> start watching a channel/playlist URL
  GET    /api/watch/list         -> list all watched entries + status
  DELETE /api/watch/<watch_id>   -> stop watching
  POST   /api/watch/tick         -> run one check-and-download pass
 
This is the simplified, local-only version of the watcher:
  - No Google Drive / rclone syncing -- videos are downloaded straight to
    your own PC's disk (DOWNLOAD_ROOT), which is permanent storage, unlike
    a cloud host's temporary disk.
  - No external cron scheduler needed -- app.py calls /api/watch/tick once
    automatically when the app starts up (see the bottom of app.py), so
    "opening the app" is what triggers a check, instead of a 6-hour timer.
  - Still runs from your own home internet connection, which YouTube treats
    as normal residential traffic rather than data-center/bot traffic.
 
Each watched entry gets its own yt-dlp `download_archive` file, so re-running
a check only ever downloads videos it hasn't seen before -- no manual diffing.
 
BLOCKED VIDEO RETRY:
Occasionally a video may still fail to download. Rather than losing track
of it, it's recorded in entry["blockedVideos"] with its direct link, and
automatically retried every time you open the app -- no manual work needed.
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
 
    _ensure_data_dir()
 
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
        "blockedVideos": [],  # [{"id":..., "url":..., "title":...}] -- retried on every check
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
 
 
def _get_archive_ids(archive_path):
    """Reads a yt-dlp download_archive file and returns the set of video IDs
    it already contains, e.g. lines like 'youtube VIDEOID' -> {'VIDEOID', ...}."""
    ids = set()
    if os.path.exists(archive_path):
        with open(archive_path, "r") as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) == 2:
                    ids.add(parts[1])
    return ids
 
 
def _make_hook(new_titles, seen_ids):
    """Shared progress hook: records a video as successfully downloaded the
    first time yt-dlp reports it 'finished' (video+audio streams both fire
    this event, so we dedupe by id)."""
    def hook(d):
        if d["status"] == "finished":
            info = d.get("info_dict") or {}
            vid = info.get("id")
            if vid and vid in seen_ids:
                return
            if vid:
                seen_ids.add(vid)
            new_titles.append(info.get("title") or "Untitled video")
    return hook
 
 
def _retry_blocked_videos(entry, folder, fmt_string):
    """Attempts to (re)download every video previously blocked. Anything
    that succeeds this time is removed from the blocked list and counted
    as a new download -- fully automatic, no manual re-triggering needed.
    Running from your home internet connection makes these retries far
    more likely to succeed than they would from a cloud server."""
    still_blocked = []
    recovered_titles = []
 
    for blocked in entry.get("blockedVideos", []):
        seen_ids = set()
        new_titles = []
        ydl_opts = {
            "format": fmt_string,
            "merge_output_format": "mp4",
            "outtmpl": os.path.join(folder, "%(upload_date)s - %(title)s.%(ext)s"),
            "download_archive": entry["archivePath"],
            "quiet": True,
            "noprogress": True,
            "ignoreerrors": True,
            "socket_timeout": 30,
            "progress_hooks": [_make_hook(new_titles, seen_ids)],
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([blocked["url"]])
        except Exception:
            pass  # still blocked -- keep it in the retry list below
 
        if new_titles:
            recovered_titles.extend(new_titles)
        else:
            still_blocked.append(blocked)
 
    entry["blockedVideos"] = still_blocked
    return recovered_titles
 
 
def _check_one(entry):
    """Runs yt-dlp against one watched URL, using its own archive file.
    Only the latest RECENT_WINDOW uploads are even considered each run --
    this avoids backfilling a channel's entire history and matches the
    "watch for upcoming videos" use case: we only care about what's new
    since last check, not the full back-catalog. Anything already in the
    archive is skipped automatically by yt-dlp.
 
    Videos are downloaded straight to DOWNLOAD_ROOT on your own disk --
    no cloud upload step. Anything that fails gets recorded in
    entry["blockedVideos"] and is automatically retried on the next check."""
    _, fmt_string = QUALITY_MAP.get(entry["quality"], QUALITY_MAP["4"])
    folder = os.path.join(DOWNLOAD_ROOT, f"watched_{entry['id']}")
    os.makedirs(folder, exist_ok=True)
 
    entry.setdefault("blockedVideos", [])
 
    # Step 1: retry anything that was blocked on a previous check.
    recovered_titles = _retry_blocked_videos(entry, folder, fmt_string)
 
    # Step 2: find out which videos currently exist on the channel (latest
    # RECENT_WINDOW), so we can tell which ones failed this run.
    try:
        list_opts = {
            "quiet": True,
            "extract_flat": True,
            "skip_download": True,
            "playlist_items": f"1-{RECENT_WINDOW}",
        }
        with yt_dlp.YoutubeDL(list_opts) as ydl:
            info = ydl.extract_info(entry["url"], download=False)
        candidates = info.get("entries") if info.get("entries") is not None else [info]
        candidates = [c for c in candidates if c and c.get("id")]
    except Exception:
        candidates = []  # if this fails, just skip blocked-video bookkeeping this round
 
    archive_ids_before = _get_archive_ids(entry["archivePath"])
    already_blocked_ids = {b["id"] for b in entry["blockedVideos"]}
 
    # Step 3: attempt the real download pass for the channel's recent uploads.
    new_titles = list(recovered_titles)
    seen_ids = set()
 
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
        "progress_hooks": [_make_hook(new_titles, seen_ids)],
    }
 
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([entry["url"]])
 
    # Step 4: anything that neither was already archived, already known-
    # blocked, nor succeeded just now is newly blocked -- queue it for
    # automatic retry next time the app is opened.
    for c in candidates:
        vid = c["id"]
        if vid in archive_ids_before or vid in already_blocked_ids or vid in seen_ids:
            continue
        vid_url = c.get("url") or c.get("webpage_url") or f"https://www.youtube.com/watch?v={vid}"
        entry["blockedVideos"].append(
            {"id": vid, "url": vid_url, "title": c.get("title") or "Untitled video"}
        )
 
    entry["lastCheckedAt"] = time.time()
    entry["lastNewVideos"] = new_titles
    entry["totalDownloaded"] = entry.get("totalDownloaded", 0) + len(new_titles)
    entry["lastError"] = None
    entry["downloadFolder"] = folder  # so the UI can show/open where files landed
    return entry
 
 
@watch_bp.route("/api/watch/tick", methods=["POST"])
def watch_tick():
    """Trigger one check-and-download pass across every watched entry.
    Called automatically once when app.py starts up (see bottom of app.py),
    so simply opening the app is what triggers a check -- no external
    scheduler needed. Can also be called manually via this endpoint
    (e.g. a "Check now" button in the UI)."""
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
        "stillBlocked": sum(len(r.get("blockedVideos", [])) for r in results),
        "results": results,
    }
    return jsonify(summary)