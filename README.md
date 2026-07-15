# YouTube Playlist Downloader — Full Stack

This project combines:
- **Your real backend** (`new.py`'s logic) — now a Flask API in `backend/app.py`, using **yt-dlp** for real playlist lookups and real downloads.
- **Your Gemini-generated frontend** — the React/Vite UI in `frontend/`, unchanged in layout and design.

## What changed and why

The frontend you got from AI Studio shipped with its own Node/Express server (`server.ts`) that:
- Called the **Gemini API to hallucinate fake playlist metadata** (titles/durations it invented, not real YouTube data)
- **Simulated** download progress with `Math.random()` — it never actually called `yt-dlp` or touched a real file

Your Python script (`new.py`), on the other hand, does real work: it uses `yt_dlp` to fetch real playlist data and download real videos with a `ThreadPoolExecutor`.

So I removed `server.ts` and the Gemini dependency entirely, and rebuilt the backend as a Flask app (`backend/app.py`) that implements the same 4 endpoints the React UI already calls — but backed by **your real yt-dlp logic** instead of fake data:

| Endpoint | What it does now |
|---|---|
| `POST /api/playlist-info` | Real `yt_dlp` playlist/video lookup (was: Gemini-generated fake data) |
| `POST /api/download/start` | Spawns a real `ThreadPoolExecutor` download job with `yt_dlp` (was: `setInterval` + random numbers) |
| `GET /api/download/status/:id` | Reports real progress from yt-dlp's own progress hooks |
| `POST /api/export-script` | Returns a real, runnable standalone `.py` script (same logic as `new.py`) |

The React UI (`App.tsx`, `PlaylistSelector.tsx`, etc.) needed **no changes** to its logic — it was already calling the right endpoints with the right shapes. I only tweaked a badge that said "AI Enhanced" to say "Live Data" instead, since the info is now real, not AI-hallucinated.

## How to run it

You need two things running at once: the Flask backend and the Vite frontend.

### 1. Backend (Flask + yt-dlp)

```bash
cd backend
pip install -r requirements.txt
python app.py
```

This starts the API on `http://localhost:5000`. Downloaded videos land in `backend/downloads/<playlist>_<channel>/`.

### 2. Frontend (React + Vite)

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

This starts the UI on `http://localhost:5173`. Vite is configured (`vite.config.ts`) to proxy every `/api/*` call to `http://localhost:5000`, so the browser only ever talks to one origin.

Open `http://localhost:5173` and use the app normally — paste a real playlist/video URL, pick quality and worker count, hit download, and it'll actually download using `yt-dlp`.

### Production build

```bash
cd frontend
npm run build
```

Serve the resulting `dist/` folder with any static file server, and point it at the Flask backend (either reverse-proxy `/api` to it, or run Flask behind something like gunicorn + nginx).

## Testing notes (what I actually verified)

This sandbox can't reach youtube.com (network egress here is restricted to package registries), so I couldn't run a live download against real YouTube from inside this environment. What I did verify, thoroughly:

- The Flask app imports and runs cleanly, all 4 endpoints respond correctly, including error cases (missing URL → 400, unknown session → 404, missing download params → 400)
- A full download session — start → poll → complete — works correctly end-to-end, with real threading, real progress-hook wiring, and real file-existence "skip if already downloaded" logic (tested by swapping in a fake `yt_dlp.YoutubeDL` that mimics real download/progress behavior, so all the Flask/threading/session code paths run for real, only the actual network call to YouTube is stubbed)
- The exported standalone script is syntactically valid Python (`compile()`-checked)
- The React frontend type-checks (`tsc --noEmit`) and builds (`vite build`) cleanly
- The full stack wired together — Vite dev server → its `/api` proxy → Flask → yt-dlp code path — was run live and exercised through real HTTP requests, and returned correct data

**What to double check on your machine**: run it against a real playlist URL once, since that's the one part (actual YouTube network access + real video/audio merging via ffmpeg) I couldn't exercise here. Make sure `ffmpeg` is installed and on your `PATH` — yt-dlp needs it to merge separate video+audio streams into an `.mp4`.
