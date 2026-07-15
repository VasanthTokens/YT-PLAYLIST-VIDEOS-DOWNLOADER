import React, { useState, useEffect, useCallback } from "react";
import { Eye, Trash2, RefreshCw, PlusCircle, CloudUpload, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { QUALITY_MAP } from "../types";

interface WatchEntry {
  id: string;
  url: string;
  quality: string;
  createdAt: number;
  lastCheckedAt: number | null;
  lastNewVideos: string[];
  totalDownloaded: number;
  lastError: string | null;
  seededExisting?: number;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "Never checked yet";
  const diffSec = Math.floor(Date.now() / 1000 - ts);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function WatchPanel() {
  const [watches, setWatches] = useState<WatchEntry[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [newQuality, setNewQuality] = useState("2");
  const [isAdding, setIsAdding] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWatches = useCallback(async () => {
    try {
      const res = await fetch("/api/watch/list");
      if (!res.ok) return;
      const data = await res.json();
      setWatches(data);
    } catch {
      // silent - list refresh failures shouldn't interrupt the UI
    }
  }, []);

  useEffect(() => {
    loadWatches();
    const interval = setInterval(loadWatches, 15000); // passive refresh every 15s
    return () => clearInterval(interval);
  }, [loadWatches]);

  const handleAdd = async () => {
    if (!newUrl.trim()) {
      setError("Please paste a channel or playlist URL first.");
      return;
    }
    setIsAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/watch/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl.trim(), quality: newQuality }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not add this channel.");
        return;
      }
      setNewUrl("");
      await loadWatches();
    } catch {
      setError("Network error while adding the watch.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/watch/${id}`, { method: "DELETE" });
      await loadWatches();
    } catch {
      setError("Could not remove this watch.");
    }
  };

  const handleTickNow = async () => {
    setIsTicking(true);
    setError(null);
    try {
      const res = await fetch("/api/watch/tick", { method: "POST" });
      await res.json();
      await loadWatches();
    } catch {
      setError("Check failed - is the server reachable?");
    } finally {
      setIsTicking(false);
    }
  };

  return (
    <div className="col-span-1 lg:col-span-12 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 md:p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-red-500" />
          <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">
            Channel Auto-Watch
          </span>
        </div>
        <button
          onClick={handleTickNow}
          disabled={isTicking || watches.length === 0}
          className="flex items-center gap-2 text-xs font-semibold bg-zinc-800 hover:bg-zinc-750 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 px-3 py-2 rounded-lg border border-zinc-700 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isTicking ? "animate-spin" : ""}`} />
          {isTicking ? "Checking..." : "Check Now"}
        </button>
      </div>

      <h2 className="text-lg font-bold text-white mb-1">Watch a channel for new uploads</h2>
      <p className="text-xs text-zinc-500 mb-4">
        Existing videos are ignored automatically - only uploads posted after you add a channel get downloaded.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <input
          type="text"
          placeholder="Paste a YouTube channel URL (e.g. https://www.youtube.com/@channel/videos)"
          className="flex-grow bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-900/20 transition-all font-mono"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <select
          value={newQuality}
          onChange={(e) => setNewQuality(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-3 text-sm text-zinc-200 focus:outline-none focus:border-red-500"
        >
          {Object.entries(QUALITY_MAP).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          disabled={isAdding}
          className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold text-sm px-5 py-3 rounded-xl transition-colors whitespace-nowrap"
        >
          <PlusCircle className="h-4 w-4" />
          {isAdding ? "Adding..." : "Watch Channel"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2 mb-3">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {watches.length === 0 ? (
        <div className="text-center py-8 text-sm text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
          No channels being watched yet. Paste a link above to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {watches.map((w) => (
            <div
              key={w.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3"
            >
              <div className="min-w-0 flex-grow">
                <div className="text-sm text-zinc-200 truncate font-mono">{w.url}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {timeAgo(w.lastCheckedAt)}
                  </span>
                  <span>{QUALITY_MAP[w.quality]?.label || w.quality}</span>
                  <span className="flex items-center gap-1 text-zinc-400">
                    <CloudUpload className="h-3 w-3" /> {w.totalDownloaded} downloaded
                  </span>
                  {w.lastError ? (
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertCircle className="h-3 w-3" /> {w.lastError}
                    </span>
                  ) : w.lastCheckedAt ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Synced
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                onClick={() => handleDelete(w.id)}
                className="shrink-0 text-zinc-500 hover:text-red-400 p-2 rounded-lg hover:bg-zinc-900 transition-colors"
                title="Stop watching this channel"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
