"""
YouTube Playlist Downloader - Real backend (Flask + yt-dlp)
 
This replaces the simulated Node/Express/Gemini server that AI Studio generated.
Every endpoint here does REAL work:
  - /api/playlist-info fetches REAL playlist/video metadata via yt-dlp
  - /api/download/start kicks off REAL downloads (ThreadPoolExecutor + yt-dlp)
  - /api/download/status/<id> reports REAL progress read from yt-dlp's own hooks
  - /api/export-script hands back a standalone .py script with the same logic
 
API shapes match src/types.ts in the React frontend exactly, so the UI
needs zero changes.
"""
import os
import re
import time
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
 
from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
 
app = Flask(__name__)
CORS(app)  # harmless if frontend is proxied same-origin; needed if you split hosts
 
import watch_manager
app.register_blueprint(watch_manager.watch_bp)
 
# ------------------------------------------------------------------
# In-memory session store (same role as `activeSessions` in server.ts)
# ------------------------------------------------------------------
sessions = {}
sessions_lock = threading.Lock()
 
QUALITY_MAP = {
    "1": ("144p", "bv*[height<=144]+ba/b[height<=144]"),
    "2": ("360p", "bv*[height<=360]+ba/b[height<=360]"),
    "3": ("720p", "bv*[height<=720]+ba/b[height<=720]"),
    "4": ("1080p", "bv*[height<=1080]+ba/b[height<=1080]"),
    "5": ("Best available", "bv*+ba/b"),
}
 
DOWNLOAD_ROOT = os.path.join(os.getcwd(), "downloads")
 
 
# ------------------------------------------------------------------
# Helpers (ported straight from new.py)
# ------------------------------------------------------------------
def sanitize_filename(name):
    name = re.sub(r'[\\/*?:"<>|]', "", name or "")
    return name.strip().rstrip(".") or "Unknown"
 
 
def format_size(num_bytes):
    n = float(num_bytes)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return f"{n:.2f} {unit}"
        n /= 1024
    return f"{n:.2f} PB"
 
 
def fetch_playlist_entries(url):
    """Real metadata fetch (no AI hallucination, no mock data)."""
    ydl_opts = {"quiet": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
 
    if info.get("entries") is not None:
        entries = [e for e in info["entries"] if e]
        title = info.get("title") or "Unknown Playlist"
        uploader = info.get("uploader") or (entries[0].get("uploader") if entries else "Unknown")
        is_single = False
    else:
        entries = [info]
        title = info.get("title", "Unknown")
        uploader = info.get("uploader", "Unknown")
        is_single = True
 
    videos = []
    for e in entries:
        vid_url = e.get("url") or e.get("webpage_url")
        if not vid_url and e.get("id"):
            vid_url = f"https://www.youtube.com/watch?v={e['id']}"
        videos.append(
            {
                "title": e.get("title") or "Untitled video",
                "duration": e.get("duration") or 0,
                "url": vid_url,
            }
        )
 
    return {
        "title": title,
        "uploader": uploader or "Unknown",
        "isSingleVideo": is_single,
        "videos": videos,
    }
 
 
# ------------------------------------------------------------------
# API: Fetch real playlist / video info
# ------------------------------------------------------------------
@app.route("/api/playlist-info", methods=["POST"])
def playlist_info():
    data = request.get_json(force=True, silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "Playlist or Video URL is required."}), 400
 
    try:
        info = fetch_playlist_entries(url)
    except Exception as e:
        return jsonify({"error": f"Could not fetch playlist info: {e}"}), 502
 
    return jsonify(
        {
            "title": info["title"],
            "uploader": info["uploader"],
            "isSingleVideo": info["isSingleVideo"],
            "videos": [{"title": v["title"], "duration": v["duration"]} for v in info["videos"]],
            "source": "yt-dlp",
        }
    )
 
 
# ------------------------------------------------------------------
# Real download worker (mirrors download_video() in new.py, but updates
# a shared session/task dict instead of printing to stdout)
# ------------------------------------------------------------------
def make_progress_hook(session, task):
    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            pct = (downloaded / total * 100) if total else 0
            speed = d.get("speed") or 0
            with sessions_lock:
                task["status"] = "downloading"
                task["progress"] = round(min(pct, 100), 1)
                task["speed"] = f"{(speed / (1024 * 1024)):.2f} MB/s" if speed else "0 B/s"
                if total:
                    task["sizeBytes"] = total
        elif d["status"] == "finished":
            with sessions_lock:
                session["logs"].append(f"✅ Merging/Finalizing: {task['title']}")
                if len(session["logs"]) > 500:
                    session["logs"] = session["logs"][-500:]
 
    return hook
 
 
def download_one(session, task, folder, fmt_string):
    filename_prefix = f"{task['videoIndex'] + 1:03d} - "
 
    existing = []
    if os.path.isdir(folder):
        existing = [f for f in os.listdir(folder) if f.startswith(filename_prefix)]
 
    if existing:
        with sessions_lock:
            task["status"] = "skipped"
            task["progress"] = 100
            session["skippedCount"] += 1
            session["logs"].append(f"⏭️  Already downloaded, skipping: {task['title']}")
        return
 
    outtmpl = os.path.join(folder, f"{task['videoIndex'] + 1:03d} - %(title)s.%(ext)s")
    ydl_opts = {
        "format": fmt_string,
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
        "quiet": True,
        "noprogress": True,
        "progress_hooks": [make_progress_hook(session, task)],
    }
 
    with sessions_lock:
        task["status"] = "downloading"
        session["logs"].append(f"⬇️  Starting: {task['title']}")
 
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([task["url"]])
 
        size = 0
        if os.path.isdir(folder):
            for f in os.listdir(folder):
                if f.startswith(filename_prefix):
                    size = os.path.getsize(os.path.join(folder, f))
                    break
 
        with sessions_lock:
            task["status"] = "finished"
            task["progress"] = 100
            task["sizeBytes"] = size or task["sizeBytes"]
            session["downloadedCount"] += 1
            session["totalBytes"] += size
            session["logs"].append(f"✓ Finished: {task['title']}")
    except Exception as e:
        with sessions_lock:
            task["status"] = "failed"
            session["failedCount"] += 1
            session["logs"].append(f"✗ Failed: {task['title']} -> {e}")
 
 
def run_download_session(session_id, url, selected_indices, quality, max_workers, folder):
    session = sessions[session_id]
    try:
        info = fetch_playlist_entries(url)
    except Exception as e:
        with sessions_lock:
            session["status"] = "failed"
            session["logs"].append(f"[ERROR] Could not fetch video list: {e}")
        return
 
    videos = info["videos"]
    _, fmt_string = QUALITY_MAP.get(quality, QUALITY_MAP["5"])
    os.makedirs(folder, exist_ok=True)
 
    tasks = []
    for idx in selected_indices:
        if idx < 0 or idx >= len(videos):
            continue
        v = videos[idx]
        task = {
            "id": uuid.uuid4().hex[:9],
            "videoIndex": idx,
            "title": v["title"],
            "url": v["url"],
            "status": "pending",
            "progress": 0,
            "speed": "0 B/s",
            "sizeBytes": 0,
        }
        tasks.append(task)
 
    with sessions_lock:
        session["tasks"] = tasks
 
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(download_one, session, t, folder, fmt_string) for t in tasks]
        for f in as_completed(futures):
            f.result()  # surface exceptions to server logs if any slip through
 
    with sessions_lock:
        session["status"] = "completed"
        session["logs"].append("=" * 50)
        session["logs"].append("DOWNLOAD SUMMARY")
        session["logs"].append(f"Downloaded : {session['downloadedCount']}")
        session["logs"].append(f"Skipped    : {session['skippedCount']}")
        session["logs"].append(f"Failed     : {session['failedCount']}")
        session["logs"].append(f"Total size : {format_size(session['totalBytes'])}")
        session["logs"].append(f"Folder     : {os.path.abspath(folder)}")
        session["logs"].append("=" * 50)
 
 
# ------------------------------------------------------------------
# API: Start a REAL download session
# ------------------------------------------------------------------
@app.route("/api/download/start", methods=["POST"])
def download_start():
    data = request.get_json(force=True, silent=True) or {}
    playlist_title = data.get("playlistTitle")
    channel = data.get("channel") or "Unknown"
    quality = data.get("quality") or "5"
    selected_videos = data.get("selectedVideos")
    url = data.get("url")
 
    try:
        max_workers = int(data.get("maxWorkers") or 2)
    except (TypeError, ValueError):
        max_workers = 2
    max_workers = min(3, max(1, max_workers))
 
    if not playlist_title or not url or not isinstance(selected_videos, list) or len(selected_videos) == 0:
        return jsonify({"error": "Missing required download parameters."}), 400
 
    session_id = uuid.uuid4().hex[:9]
    folder_name = f"{sanitize_filename(playlist_title)}_{sanitize_filename(channel)}"
    folder = os.path.join(DOWNLOAD_ROOT, folder_name)
 
    session = {
        "id": session_id,
        "playlistTitle": playlist_title,
        "channel": channel,
        "folderName": folder_name,
        "quality": quality,
        "maxWorkers": max_workers,
        "tasks": [],
        "status": "running",
        "downloadedCount": 0,
        "skippedCount": 0,
        "failedCount": 0,
        "totalBytes": 0,
        "startTime": time.time(),
        "elapsedSeconds": 0,
        "logs": [
            "=" * 50,
            "YOUTUBE PLAYLIST DOWNLOADER (LIVE BACKEND)",
            "=" * 50,
            f"Folder        : {folder}",
            f"Parallel jobs : {max_workers}",
            "=" * 50,
        ],
    }
 
    with sessions_lock:
        sessions[session_id] = session
 
    selected_indices = []
    for v in selected_videos:
        try:
            selected_indices.append(int(v["index"]))
        except (KeyError, TypeError, ValueError):
            continue
 
    thread = threading.Thread(
        target=run_download_session,
        args=(session_id, url, selected_indices, quality, max_workers, folder),
        daemon=True,
    )
    thread.start()
 
    return jsonify({"sessionId": session_id})
 
 
# ------------------------------------------------------------------
# API: Poll session status
# ------------------------------------------------------------------
@app.route("/api/download/status/<session_id>", methods=["GET"])
def download_status(session_id):
    session = sessions.get(session_id)
    if not session:
        return jsonify({"error": "Session not found."}), 404
 
    with sessions_lock:
        session["elapsedSeconds"] = int(time.time() - session["startTime"])
        return jsonify(session)
 
 
# ------------------------------------------------------------------
# API: Export a standalone, real, runnable python script
# ------------------------------------------------------------------
SCRIPT_TEMPLATE = '''import yt_dlp
import itertools
import os
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
 
# ------------------------------------------------------------------
# Pre-configured from your web selections
# ------------------------------------------------------------------
PLAYLIST_URL = {playlist_url!r}
SELECTED_INDICES = {selected_indices!r}  # 0-based indices into the playlist
QUALITY_CHOICE = {quality!r}
MAX_WORKERS = {max_workers}
 
QUALITY_MAP = {{
    "1": ("144p", "bv*[height<=144]+ba/b[height<=144]"),
    "2": ("360p", "bv*[height<=360]+ba/b[height<=360]"),
    "3": ("720p", "bv*[height<=720]+ba/b[height<=720]"),
    "4": ("1080p", "bv*[height<=1080]+ba/b[height<=1080]"),
    "5": ("Best available", "bv*+ba/b"),
}}
 
print_lock = threading.Lock()
stats_lock = threading.Lock()
stats = {{"downloaded": 0, "skipped": 0, "failed": 0, "total_bytes": 0}}
 
 
def sanitize_filename(name):
    name = re.sub(r'[\\\\/*?:"<>|]', "", name or "")
    return name.strip().rstrip(".") or "Unknown"
 
 
def format_size(num_bytes):
    n = float(num_bytes)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return f"{{n:.2f}} {{unit}}"
        n /= 1024
    return f"{{n:.2f}} PB"
 
 
def get_playlist_info(url):
    ydl_opts = {{"quiet": True, "extract_flat": True, "skip_download": True}}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(url, download=False)
 
 
def download_video(video_url, video_title, index, folder, fmt_string, label):
    prefix = f"{{index + 1:03d}} - "
    if os.path.isdir(folder) and any(f.startswith(prefix) for f in os.listdir(folder)):
        with print_lock:
            print(f"⏭️  [{{label}}] Already downloaded, skipping: {{video_title}}")
        with stats_lock:
            stats["skipped"] += 1
        return
 
    outtmpl = os.path.join(folder, f"{{index + 1:03d}} - %(title)s.%(ext)s")
    ydl_opts = {{
        "format": fmt_string,
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
        "quiet": True,
        "noprogress": True,
    }}
 
    with print_lock:
        print(f"⬇️  [{{label}}] Starting: {{video_title}}")
 
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([video_url])
 
    size = 0
    if os.path.isdir(folder):
        for f in os.listdir(folder):
            if f.startswith(prefix):
                size = os.path.getsize(os.path.join(folder, f))
                break
 
    with stats_lock:
        stats["downloaded"] += 1
        stats["total_bytes"] += size
 
    with print_lock:
        print(f"✓ [{{label}}] Finished: {{video_title}}")
 
 
def main():
    info = get_playlist_info(PLAYLIST_URL)
    entries = info["entries"] if info.get("entries") is not None else [info]
    entries = [e for e in entries if e]
 
    title = info.get("title", "Unknown")
    channel = info.get("uploader", "Unknown")
 
    selected = SELECTED_INDICES or list(range(len(entries)))
    _, fmt_string = QUALITY_MAP.get(QUALITY_CHOICE, QUALITY_MAP["5"])
 
    folder = os.path.join("downloads", f"{{sanitize_filename(title)}}_{{sanitize_filename(channel)}}")
    os.makedirs(folder, exist_ok=True)
 
    print("=" * 50)
    print("DOWNLOAD STARTED")
    print(f"Folder        : {{folder}}")
    print(f"Parallel jobs : {{MAX_WORKERS}}")
    print("=" * 50)
 
    start_time = time.time()
 
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {{}}
        for count, index in enumerate(selected, start=1):
            if index < 0 or index >= len(entries):
                continue
            video = entries[index]
            video_url = video.get("url") or video.get("webpage_url")
            label = f"{{count}}/{{len(selected)}}"
            future = executor.submit(
                download_video, video_url, video.get("title", "Untitled"),
                index, folder, fmt_string, label,
            )
            futures[future] = video.get("title", "Untitled")
 
        for future in as_completed(futures):
            video_title = futures[future]
            try:
                future.result()
            except Exception as e:
                with stats_lock:
                    stats["failed"] += 1
                with print_lock:
                    print(f"✗ Failed: {{video_title}} -> {{e}}")
 
    elapsed = time.time() - start_time
    print("=" * 50)
    print("DOWNLOAD SUMMARY")
    print(f"Downloaded : {{stats['downloaded']}}")
    print(f"Skipped    : {{stats['skipped']}}")
    print(f"Failed     : {{stats['failed']}}")
    print(f"Total size : {{format_size(stats['total_bytes'])}}")
    print(f"Time taken : {{elapsed:.1f}}s")
    print(f"Folder path: {{os.path.abspath(folder)}}")
    print("=" * 50)
 
 
if __name__ == "__main__":
    main()
'''
 
 
@app.route("/api/export-script", methods=["POST"])
def export_script():
    data = request.get_json(force=True, silent=True) or {}
    playlist_url = data.get("playlistUrl") or "https://www.youtube.com/playlist?list=PLxxxxxxxx"
    selected_indexes = data.get("selectedIndexes") or []
    quality = data.get("quality") or "5"
    try:
        max_workers = int(data.get("maxWorkers") or 2)
    except (TypeError, ValueError):
        max_workers = 2
 
    script = SCRIPT_TEMPLATE.format(
        playlist_url=playlist_url,
        selected_indices=list(selected_indexes),
        quality=quality,
        max_workers=max_workers,
    )
    return jsonify({"script": script, "filename": "downloader.py"})
 
 
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
 
 
import sys
watch_manager._init(sys.modules[__name__])
 
if __name__ == "__main__":
    os.makedirs(DOWNLOAD_ROOT, exist_ok=True)
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug_mode)