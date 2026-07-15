import React, { useState } from "react";
import { PlaylistInfo } from "../types";
import { Check, Square, CheckSquare, Search, Eye, Filter, Film, Clock } from "lucide-react";

interface PlaylistSelectorProps {
  playlistInfo: PlaylistInfo;
  selectedIndices: number[];
  onToggleIndex: (index: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

export function PlaylistSelector({
  playlistInfo,
  selectedIndices,
  onToggleIndex,
  onSelectAll,
  onSelectNone,
}: PlaylistSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "selected" | "unselected">("all");

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (hours > 0) {
      return `${hours}h ${remainingMins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  // Filter videos based on search query and mode
  const filteredVideos = playlistInfo.videos
    .map((video, index) => ({ video, originalIndex: index }))
    .filter(({ video, originalIndex }) => {
      const matchesSearch = video.title.toLowerCase().includes(searchQuery.toLowerCase());
      const isSelected = selectedIndices.includes(originalIndex);
      
      if (filterMode === "selected") return matchesSearch && isSelected;
      if (filterMode === "unselected") return matchesSearch && !isSelected;
      return matchesSearch;
    });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl" id="playlist-selector-panel">
      {/* Header Info */}
      <div className="p-6 border-b border-slate-800 bg-slate-900/60 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Active Playlist
            </span>
            {playlistInfo.source === "yt-dlp" && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Live Data
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">{playlistInfo.title}</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            By <span className="text-slate-300 font-medium">{playlistInfo.uploader}</span> • {playlistInfo.videos.length} videos available
          </p>
        </div>

        <div className="flex items-center gap-3 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 self-start md:self-auto">
          <div className="text-right">
            <div className="text-xs text-slate-500 font-mono uppercase">Selection</div>
            <div className="text-sm font-bold text-emerald-400 font-mono">
              {selectedIndices.length} / {playlistInfo.videos.length} Selected
            </div>
          </div>
          <div className="h-8 w-px bg-slate-800"></div>
          <div className="flex gap-1">
            <button
              onClick={onSelectAll}
              className="px-2.5 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              title="Select All"
              id="select-all-btn"
            >
              All
            </button>
            <button
              onClick={onSelectNone}
              className="px-2.5 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              title="Clear Selection"
              id="select-none-btn"
            >
              None
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-slate-950/40 border-b border-slate-850 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search playlist videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all font-sans"
            id="search-videos-input"
          />
        </div>
        
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setFilterMode("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap ${
              filterMode === "all"
                ? "bg-slate-800 text-slate-100 border-slate-700"
                : "bg-transparent text-slate-400 border-transparent hover:text-slate-200"
            }`}
            id="filter-all-btn"
          >
            <Film className="h-3 w-3" />
            All ({playlistInfo.videos.length})
          </button>
          <button
            onClick={() => setFilterMode("selected")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap ${
              filterMode === "selected"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-transparent text-slate-400 border-transparent hover:text-emerald-400/80"
            }`}
            id="filter-selected-btn"
          >
            <CheckSquare className="h-3 w-3" />
            Selected ({selectedIndices.length})
          </button>
          <button
            onClick={() => setFilterMode("unselected")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap ${
              filterMode === "unselected"
                ? "bg-slate-800 text-slate-100 border-slate-700"
                : "bg-transparent text-slate-400 border-transparent hover:text-slate-200"
            }`}
            id="filter-unselected-btn"
          >
            <Square className="h-3 w-3" />
            Excluded ({playlistInfo.videos.length - selectedIndices.length})
          </button>
        </div>
      </div>

      {/* Video list */}
      <div className="max-h-96 overflow-y-auto divide-y divide-slate-850/60" id="video-items-list">
        {filteredVideos.length === 0 ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
            <Filter className="h-8 w-8 text-slate-650" />
            <p className="text-sm">No videos found matching your filters</p>
          </div>
        ) : (
          filteredVideos.map(({ video, originalIndex }) => {
            const isSelected = selectedIndices.includes(originalIndex);
            return (
              <div
                key={originalIndex}
                onClick={() => onToggleIndex(originalIndex)}
                className={`group flex items-center gap-4 px-4 py-3.5 hover:bg-slate-850/40 cursor-pointer transition-all ${
                  isSelected ? "bg-slate-900/30" : "bg-transparent"
                }`}
                id={`video-item-${originalIndex}`}
              >
                {/* Checkbox */}
                <div className="flex-shrink-0">
                  {isSelected ? (
                    <div className="h-5 w-5 rounded bg-emerald-500 text-slate-950 flex items-center justify-center shadow-md shadow-emerald-500/10">
                      <Check className="h-3.5 w-3.5 stroke-[3px]" />
                    </div>
                  ) : (
                    <div className="h-5 w-5 rounded border border-slate-700 group-hover:border-slate-500 transition-colors" />
                  )}
                </div>

                {/* Index badge */}
                <div className="flex-shrink-0 font-mono text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800/80 w-12 text-center">
                  {(originalIndex + 1).toString().padStart(3, "0")}
                </div>

                {/* Video Info */}
                <div className="flex-1 min-w-0">
                  <h4 className={`text-sm font-medium truncate transition-colors ${
                    isSelected ? "text-slate-200" : "text-slate-400 group-hover:text-slate-300"
                  }`}>
                    {video.title}
                  </h4>
                </div>

                {/* Duration */}
                <div className="flex-shrink-0 flex items-center gap-1.5 text-xs text-slate-500 font-mono bg-slate-950/40 px-2.5 py-1 rounded border border-slate-850">
                  <Clock className="h-3 w-3 text-slate-650" />
                  {formatDuration(video.duration)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer statistics */}
      <div className="p-4 bg-slate-950/60 border-t border-slate-850 flex items-center justify-between text-xs text-slate-500 font-mono">
        <div>
          Showing {filteredVideos.length} of {playlistInfo.videos.length} items
        </div>
        <div className="flex items-center gap-1.5">
          <Eye className="h-3 w-3 text-emerald-400/80 animate-pulse" />
          <span>Real-time local downloader simulation active</span>
        </div>
      </div>
    </div>
  );
}
