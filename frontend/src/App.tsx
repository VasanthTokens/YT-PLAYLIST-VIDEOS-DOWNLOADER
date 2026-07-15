import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Pause, 
  Download, 
  Terminal as TerminalIcon, 
  Layers, 
  Cpu, 
  Settings, 
  RefreshCw, 
  FileCode, 
  CheckCircle2, 
  AlertCircle, 
  FolderOpen, 
  Copy, 
  Check, 
  Youtube, 
  Sliders, 
  Sparkles, 
  Eye, 
  Trash2,
  ExternalLink,
  ChevronRight,
  Monitor
} from "lucide-react";
import { PlaylistInfo, DownloadSession, QUALITY_MAP } from "./types";
import { PlaylistSelector } from "./components/PlaylistSelector";
import { WatchPanel } from "./components/WatchPanel";

export default function App() {
  // Input URL state
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null);
  
  // Selected video indices
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  
  // Downloader settings
  const [quality, setQuality] = useState("5"); // Default: Best available
  const [maxWorkers, setMaxWorkers] = useState(2); // Default: 2 threads

  // Active simulated download session state
  const [activeSession, setActiveSession] = useState<DownloadSession | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Script export state
  const [exportedScript, setExportedScript] = useState<string>("");
  const [isCopied, setIsCopied] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);

  // Status message/alert
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Terminal Ref for autoscroll
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Show a notification helper
  const triggerNotification = (message: string, type: "success" | "error" | "info" = "success") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // Fetch playlist info from server
  const fetchPlaylistDetails = async (targetUrl?: string) => {
    const urlToFetch = targetUrl || playlistUrl;
    if (!urlToFetch.trim()) {
      triggerNotification("Please enter a valid YouTube playlist or video URL.", "error");
      return;
    }

    setIsLoadingInfo(true);
    triggerNotification("Analyzing playlist structures...", "info");

    try {
      const response = await fetch("/api/playlist-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlToFetch }),
      });

      if (!response.ok) {
        throw new Error("Failed to load playlist information.");
      }

      const data: PlaylistInfo = await response.json();
      setPlaylistInfo(data);
      // Auto-select all videos initially
      setSelectedIndices(data.videos.map((_, i) => i));
      triggerNotification(`Loaded "${data.title}" with ${data.videos.length} videos.`, "success");
    } catch (error: any) {
      console.error(error);
      triggerNotification("Failed to fetch playlist details. Loaded local system defaults.", "error");
    } finally {
      setIsLoadingInfo(false);
    }
  };

  // Poll active session details
  useEffect(() => {
    let intervalId: any;
    if (isPolling && activeSession?.id) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(`/api/download/status/${activeSession.id}`);
          if (!res.ok) throw new Error("Failed to poll status.");
          
          const sessionData: DownloadSession = await res.json();
          setActiveSession(sessionData);

          // Auto-scroll terminal log
          if (terminalEndRef.current) {
            terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
          }

          if (sessionData.status === "completed" || sessionData.status === "failed") {
            setIsPolling(false);
            if (sessionData.status === "completed") {
              triggerNotification("All requested downloads completed successfully!", "success");
            } else {
              triggerNotification("Download session encountered an error.", "error");
            }
          }
        } catch (error) {
          console.error(error);
          setIsPolling(false);
        }
      }, 900);
    }
    return () => clearInterval(intervalId);
  }, [isPolling, activeSession?.id]);

  // Selection helpers
  const handleToggleIndex = (index: number) => {
    if (selectedIndices.includes(index)) {
      setSelectedIndices(selectedIndices.filter(i => i !== index));
    } else {
      setSelectedIndices([...selectedIndices, index].sort((a, b) => a - b));
    }
  };

  const handleSelectAll = () => {
    if (playlistInfo) {
      setSelectedIndices(playlistInfo.videos.map((_, i) => i));
    }
  };

  const handleSelectNone = () => {
    setSelectedIndices([]);
  };

  // Start downloader simulation
  const handleStartDownload = async () => {
    if (!playlistInfo) {
      triggerNotification("No playlist loaded to download.", "error");
      return;
    }

    if (selectedIndices.length === 0) {
      triggerNotification("Please select at least 1 video to download.", "error");
      return;
    }

    triggerNotification("Spawning yt-dlp simulation thread...", "info");

    try {
      const selectedVideos = selectedIndices.map(index => ({
        index,
        title: playlistInfo.videos[index].title
      }));

      const response = await fetch("/api/download/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistTitle: playlistInfo.title,
          channel: playlistInfo.uploader,
          quality,
          maxWorkers,
          selectedVideos,
          url: playlistUrl
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to start download session.");
      }

      const session: { sessionId: string } = await response.json();
      
      // Initialize local state for the session immediately
      setActiveSession({
        id: session.sessionId,
        playlistTitle: playlistInfo.title,
        channel: playlistInfo.uploader,
        folderName: `${playlistInfo.title.replace(/[^a-zA-Z0-9]/g, "_")}_${playlistInfo.uploader.replace(/[^a-zA-Z0-9]/g, "_")}`,
        quality,
        maxWorkers,
        tasks: [],
        status: "running",
        downloadedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        totalBytes: 0,
        startTime: Date.now(),
        elapsedSeconds: 0,
        logs: ["[SYSTEM] Initiating remote sandbox threads...", "[SYSTEM] Connecting sockets..."]
      });

      setIsPolling(true);
    } catch (err) {
      console.error(err);
      triggerNotification("Failed to boot simulated thread.", "error");
    }
  };

  // Fetch preconfigured Python script code
  const handleExportScript = async () => {
    try {
      const response = await fetch("/api/export-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistUrl,
          selectedIndexes: selectedIndices,
          quality,
          maxWorkers,
          title: playlistInfo?.title,
          channel: playlistInfo?.uploader,
        }),
      });

      if (!response.ok) throw new Error("Could not export script.");
      const data = await response.json();
      setExportedScript(data.script);
      setShowScriptModal(true);
    } catch (err) {
      console.error(err);
      triggerNotification("Failed to generate Python automation script.", "error");
    }
  };

  // Copy python script to clipboard
  const handleCopyScript = () => {
    navigator.clipboard.writeText(exportedScript);
    setIsCopied(true);
    triggerNotification("Copied python file to clipboard!", "success");
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Format Helper for file sizes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 MB";
    let size = bytes;
    for (const unit of ["B", "KB", "MB", "GB"]) {
      if (size < 1024) return `${size.toFixed(1)} ${unit}`;
      size /= 1024;
    }
    return `${size.toFixed(1)} TB`;
  };

  // Estimated Size Calculator
  const getEstimatedTotalSize = () => {
    let sizePerVideo = 40; // Default: ~40MB (720p equivalent)
    if (quality === "1") sizePerVideo = 8;     // 144p
    else if (quality === "2") sizePerVideo = 20; // 360p
    else if (quality === "3") sizePerVideo = 55; // 720p
    else if (quality === "4") sizePerVideo = 110; // 1080p
    else sizePerVideo = 160;                     // Best

    const totalEstBytes = selectedIndices.length * sizePerVideo * 1024 * 1024;
    return formatBytes(totalEstBytes);
  };

  const getEstimatedFinishTime = () => {
    if (!activeSession || activeSession.status !== "running") return "--:--";
    const remainingTasks = selectedIndices.length - (activeSession.downloadedCount + activeSession.skippedCount + activeSession.failedCount);
    if (remainingTasks <= 0) return "Completed";
    
    // Average 15 seconds per download divided by concurrency threads
    const secondsRemaining = Math.max(5, Math.ceil((remainingTasks * 14) / maxWorkers));
    const finishTimestamp = Date.now() + secondsRemaining * 1000;
    
    return new Date(finishTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans p-4 md:p-8 flex flex-col justify-between selection:bg-red-500/30 selection:text-red-200">
      
      {/* Notifications system bar */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-2xl border flex items-center gap-3 animate-bounce max-w-sm ${
          notification.type === "success" 
            ? "bg-zinc-900 border-emerald-500/40 text-emerald-300"
            : notification.type === "error"
            ? "bg-zinc-900 border-red-500/40 text-red-300"
            : "bg-zinc-900 border-zinc-700 text-zinc-300"
        }`} id="notification-toast">
          {notification.type === "success" ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" /> : <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />}
          <span className="text-sm font-medium">{notification.message}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto w-full flex-grow flex flex-col gap-6">
        
        {/* Header - Modern Minimal Branding */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-zinc-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-900/30 transition-transform hover:scale-105 duration-300">
              <Youtube className="w-6 h-6 text-white fill-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-white font-mono">SENTINEL</h1>
                <span className="text-[10px] font-bold tracking-widest uppercase bg-zinc-900 text-zinc-500 px-2 py-0.5 rounded border border-zinc-800">
                  v2.4
                </span>
              </div>
              <p className="text-xs text-zinc-500">Fast multi-threaded downloader & auto-channel watcher</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-400 flex items-center gap-2 shadow-inner">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span>SYSTEM STATUS: </span>
              <span className="text-emerald-400 font-bold tracking-wider uppercase">ONLINE</span>
            </div>
          </div>
        </header>

        {/* BENTO GRID CONTAINER */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-grow">
          
          {/* Card 1: URL Input Box (col-span-8) */}
          <div className="col-span-1 lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 md:p-6 flex flex-col justify-between shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity">
              <Youtube className="w-32 h-32 text-white" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 flex items-center gap-1.5">
                  <Youtube className="h-3 w-3 text-red-500" />
                  YouTube Source Configuration
                </span>
                <span className="text-xs text-zinc-400 hidden sm:inline">Supports playlist urls or video IDs</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-4">Paste your YouTube link below to dissect</h2>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-grow relative">
                  <input 
                    type="text" 
                    placeholder="Enter your playlist link here..." 
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-3.5 text-sm font-sans text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-900/20 transition-all font-mono"
                    value={playlistUrl}
                    onChange={(e) => setPlaylistUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchPlaylistDetails()}
                    id="youtube-url-input"
                  />
                  {playlistUrl && (
                    <button 
                      onClick={() => setPlaylistUrl("")}
                      className="absolute right-3 top-3.5 text-zinc-500 hover:text-zinc-300 transition-colors p-0.5 rounded"
                      title="Clear text"
                      id="clear-url-btn"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => fetchPlaylistDetails()}
                  disabled={isLoadingInfo}
                  className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:border-zinc-850 text-white font-bold px-6 py-3.5 rounded-xl transition-all shadow-lg shadow-red-900/10 active:scale-[0.98] flex items-center justify-center gap-2 shrink-0 border border-red-500/20 cursor-pointer"
                  id="fetch-details-btn"
                >
                  {isLoadingInfo ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>PARSING...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 text-amber-300" />
                      <span>FETCH DETAILS</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Playlist Meta Info (col-span-4) */}
          <div className="col-span-1 lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl relative overflow-hidden" id="playlist-meta-bento">
            <div className="absolute top-0 right-0 p-4 text-zinc-800/10 pointer-events-none">
              <Layers className="w-24 h-24" />
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 block mb-3">
                Loaded Media Info
              </span>
              
              {playlistInfo ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-black leading-tight text-white mb-1 line-clamp-2" title={playlistInfo.title}>
                      {playlistInfo.title}
                    </h3>
                    <p className="text-sm text-zinc-400">
                      Uploader: <span className="text-red-400 font-medium">{playlistInfo.uploader}</span>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-800">
                    <div className="bg-zinc-950/50 p-3 rounded-xl border border-zinc-850">
                      <p className="text-2xl font-black text-white font-mono">{playlistInfo.videos.length}</p>
                      <p className="text-[9px] uppercase text-zinc-500 font-bold tracking-wider mt-0.5">Total Clips</p>
                    </div>
                    <div className="bg-zinc-950/50 p-3 rounded-xl border border-zinc-850">
                      <p className="text-2xl font-black text-emerald-400 font-mono">{selectedIndices.length}</p>
                      <p className="text-[9px] uppercase text-zinc-500 font-bold tracking-wider mt-0.5">Selected</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-zinc-600">
                  <RefreshCw className="h-8 w-8 mx-auto mb-2 text-zinc-700 animate-pulse" />
                  <p className="text-sm">Fetching remote data structures...</p>
                </div>
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-500 font-mono">
              <span>Est. Total Size:</span>
              <span className="text-zinc-300 font-bold">{getEstimatedTotalSize()}</span>
            </div>
          </div>

          {/* Card 3: Worker Threads Selector (col-span-4) */}
          <div className="col-span-1 lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl relative" id="threads-selector-bento">
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-red-500" />
                  Thread Concurrency
                </span>
                <span className="text-[10px] font-mono font-bold bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded border border-yellow-500/20">
                  anti rate-limit
                </span>
              </div>
              <p className="text-xs text-zinc-400 mb-4">
                Parallel downloader worker instances. Higher speeds risk temporary IP bans.
              </p>

              <div className="flex items-center justify-between bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                <button 
                  onClick={() => setMaxWorkers(prev => Math.max(1, prev - 1))}
                  className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-center hover:bg-zinc-850 active:scale-95 text-zinc-200 hover:text-white transition-all font-bold text-lg"
                  id="decrease-threads-btn"
                >
                  -
                </button>
                <div className="text-center">
                  <span className="text-2xl font-black text-white font-mono">{maxWorkers}</span>
                  <span className="text-[10px] text-zinc-500 font-bold block uppercase tracking-wider">Active Workers</span>
                </div>
                <button 
                  onClick={() => setMaxWorkers(prev => Math.min(3, prev + 1))}
                  className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-center hover:bg-zinc-850 active:scale-95 text-zinc-200 hover:text-white transition-all font-bold text-lg"
                  id="increase-threads-btn"
                >
                  +
                </button>
              </div>
            </div>

            <div className="mt-4 text-[10px] text-zinc-500 italic text-center font-mono">
              {maxWorkers === 1 ? "⚠️ Safe single thread mode" : maxWorkers === 3 ? "🔥 Maximum speed allowed by client" : "⚙️ Ideal recommended default"}
            </div>
          </div>

          {/* Card 4: Video Quality Selectors (col-span-8) */}
          <div className="col-span-1 lg:col-span-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl" id="quality-selector-bento">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 flex items-center gap-1.5 mb-3">
                <Sliders className="h-3.5 w-3.5 text-red-500" />
                yt-dlp Format Preset Selection
              </span>
              <h3 className="text-lg font-bold text-white mb-4">Output Media Quality Resolution</h3>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {Object.entries(QUALITY_MAP).map(([key, info]) => {
                  const isSelected = quality === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setQuality(key)}
                      className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between group h-24 cursor-pointer relative overflow-hidden ${
                        isSelected 
                          ? "bg-red-600/10 border-red-500 text-white shadow-md shadow-red-950/20" 
                          : "bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:bg-zinc-850/50 hover:border-zinc-700"
                      }`}
                      id={`quality-btn-${key}`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-xs font-mono font-bold uppercase ${isSelected ? "text-red-400" : "text-zinc-500"}`}>
                          Option {key}
                        </span>
                        {isSelected && <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping"></span>}
                      </div>

                      <div>
                        <p className={`text-base font-black tracking-tight ${isSelected ? "text-white" : "text-zinc-200 group-hover:text-white"}`}>
                          {info.label}
                        </p>
                        <p className="text-[8px] text-zinc-500 uppercase font-mono truncate w-full mt-0.5">
                          {info.label === "Best available" ? "Best Video+Audio" : `${info.label} resolution`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs font-mono text-zinc-500">
              <span>Selected Format:</span>
              <span className="text-zinc-300 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-850 select-all">
                {QUALITY_MAP[quality]?.details}
              </span>
            </div>
          </div>

          {/* Left Large Column (col-span-8) - Dual Tab: Videos List & Active queue */}
          <div className="col-span-1 lg:col-span-8 space-y-6">
            
            {/* Tab 1: Video List Selector (from custom nested component) */}
            {playlistInfo && (
              <PlaylistSelector 
                playlistInfo={playlistInfo}
                selectedIndices={selectedIndices}
                onToggleIndex={handleToggleIndex}
                onSelectAll={handleSelectAll}
                onSelectNone={handleSelectNone}
              />
            )}

            {/* Tab 2: Queue Progress Monitor */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between" id="active-queue-panel">
              <div>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeSession?.status === "running" ? "bg-red-400" : "bg-zinc-600"}`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${activeSession?.status === "running" ? "bg-red-500" : "bg-zinc-600"}`}></span>
                    </span>
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest font-mono">Active Download Queue</h3>
                  </div>

                  <div className="flex gap-4 text-xs font-mono">
                    <span className="text-emerald-400 font-bold">Downloaded: {activeSession?.downloadedCount || 0}</span>
                    <span className="text-zinc-500">Total: {selectedIndices.length}</span>
                  </div>
                </div>

                {/* Queue video list progress bars */}
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {!activeSession ? (
                    <div className="py-12 border-2 border-dashed border-zinc-800 rounded-xl text-center text-zinc-600">
                      <Download className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm font-medium">No download session started yet.</p>
                      <p className="text-[11px] mt-1 max-w-xs mx-auto">Configure your settings above and click "Launch Download Simulation" below to trigger details.</p>
                    </div>
                  ) : (
                    activeSession.tasks.map((task, index) => {
                      return (
                        <div 
                          key={task.id}
                          className={`p-3 rounded-xl border transition-all flex items-center gap-4 ${
                            task.status === "downloading"
                              ? "bg-zinc-950/80 border-red-900/40 shadow-inner"
                              : task.status === "finished"
                              ? "bg-emerald-500/5 border-emerald-500/20"
                              : task.status === "skipped"
                              ? "bg-zinc-900/50 border-zinc-850 text-zinc-500"
                              : task.status === "failed"
                              ? "bg-red-500/5 border-red-500/20 text-red-400"
                              : "bg-zinc-950/20 border-zinc-850 text-zinc-500"
                          }`}
                          id={`queue-task-${task.id}`}
                        >
                          <div className="font-mono text-xs text-zinc-500 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-850">
                            {(task.videoIndex + 1).toString().padStart(3, "0")}
                          </div>

                          <div className="flex-grow min-w-0">
                            <div className="flex justify-between items-center text-xs mb-1.5 gap-2">
                              <span className="font-medium truncate text-zinc-200" title={task.title}>
                                {task.title}
                              </span>
                              <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                                {task.status === "downloading" && `⚡ ${task.speed}`}
                                {task.status === "finished" && "Completed"}
                                {task.status === "skipped" && "Skipped"}
                                {task.status === "failed" && "Failed"}
                                {task.status === "pending" && "In Queue"}
                              </span>
                            </div>

                            <div className="w-full bg-zinc-950 h-1.5 rounded-full overflow-hidden border border-zinc-900">
                              <div 
                                className={`h-1.5 rounded-full transition-all duration-300 ${
                                  task.status === "downloading" 
                                    ? "bg-red-500" 
                                    : task.status === "finished" || task.status === "skipped"
                                    ? "bg-emerald-500"
                                    : task.status === "failed"
                                    ? "bg-red-400"
                                    : "bg-zinc-800"
                                }`}
                                style={{ width: `${task.progress}%` }}
                              ></div>
                            </div>
                          </div>

                          <div className="text-xs font-mono font-bold shrink-0 w-8 text-right text-zinc-300">
                            {Math.round(task.progress)}%
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Download trigger buttons */}
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleStartDownload}
                  disabled={selectedIndices.length === 0 || isPolling}
                  className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:border-zinc-850 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-red-900/10 hover:shadow-red-900/30 active:scale-[0.99] flex items-center justify-center gap-2 border border-red-500/20 cursor-pointer"
                  id="launch-download-btn"
                >
                  <Play className="h-4 w-4 text-white fill-white" />
                  <span>LAUNCH DOWNLOAD SIMULATION</span>
                </button>

                <button
                  onClick={handleExportScript}
                  className="bg-zinc-950 hover:bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 px-6 py-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer font-bold"
                  id="compiler-options-btn"
                >
                  <FileCode className="h-4 w-4 text-red-400" />
                  <span>COMPILE PYTHON SCRIPT</span>
                </button>
              </div>
            </div>

            {/* Interactive CLI Console TerminalLogs */}
            <div className="bg-black border border-zinc-800 rounded-2xl p-5 shadow-2xl relative overflow-hidden" id="terminal-bento-card">
              <div className="absolute top-0 right-0 p-4 opacity-[0.02] pointer-events-none">
                <TerminalIcon className="w-32 h-32 text-emerald-400" />
              </div>

              <div className="flex items-center justify-between border-b border-zinc-900 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80 inline-block"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
                  </div>
                  <div className="h-4 w-px bg-zinc-800 mx-1"></div>
                  <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-zinc-500">stdout Console Logs</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                  <span>yt_dlp engine active</span>
                </div>
              </div>

              {/* Terminal Screen container */}
              <div className="bg-zinc-950/80 rounded-xl p-4 font-mono text-xs text-zinc-400 border border-zinc-900/60 h-64 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-zinc-800">
                {activeSession ? (
                  activeSession.logs.map((log, index) => {
                    let logColor = "text-zinc-400";
                    if (log.startsWith("✅") || log.startsWith("✓")) logColor = "text-emerald-400 font-medium";
                    else if (log.startsWith("❌") || log.includes("Failed") || log.startsWith("✗")) logColor = "text-red-400 font-medium";
                    else if (log.startsWith("⏭️")) logColor = "text-yellow-500/80 font-medium";
                    else if (log.startsWith("==")) logColor = "text-red-500 font-semibold";
                    
                    return (
                      <div key={index} className={`whitespace-pre-wrap leading-relaxed ${logColor}`}>
                        {log}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-zinc-600 italic py-16 text-center">
                    <div>$ python downloader.py</div>
                    <div className="text-[11px] mt-2 text-zinc-700">Await thread launch to stream console outputs from the yt-dlp binary shell hook...</div>
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>

              <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-600 font-mono">
                <span>Buffer: 500 lines</span>
                <span>Active session logs automatically synced</span>
              </div>
            </div>

          </div>

          {/* Right Bento Column: Download Summary & Call to Action (col-span-4) */}
          <div className="col-span-1 lg:col-span-4 space-y-6">
            
            {/* Download Summary Card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden" id="summary-bento-card">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <FileCode className="w-20 h-20 text-white" />
              </div>

              <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 block mb-5">
                Download Statistics
              </span>

              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-zinc-850 pb-2.5">
                  <span className="text-zinc-400 text-sm font-medium">Session Status</span>
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border uppercase ${
                    activeSession?.status === "completed"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : activeSession?.status === "running"
                      ? "bg-red-500/10 text-red-400 border-red-500/20 animate-pulse"
                      : "bg-zinc-950 text-zinc-500 border-zinc-800"
                  }`}>
                    {activeSession?.status || "Idle"}
                  </span>
                </div>

                <div className="flex justify-between items-end border-b border-zinc-850 pb-2.5">
                  <span className="text-zinc-400 text-sm">Total Processed</span>
                  <span className="text-xl font-bold font-mono text-white">
                    {activeSession ? (activeSession.downloadedCount + activeSession.skippedCount + activeSession.failedCount) : 0}
                    <span className="text-xs text-zinc-500 font-normal"> / {selectedIndices.length}</span>
                  </span>
                </div>

                <div className="flex justify-between items-end border-b border-zinc-850 pb-2.5">
                  <span className="text-zinc-400 text-sm">Downloaded File size</span>
                  <span className="text-xl font-bold font-mono text-emerald-400">
                    {formatBytes(activeSession?.totalBytes || 0)}
                  </span>
                </div>

                <div className="flex justify-between items-end border-b border-zinc-850 pb-2.5">
                  <span className="text-zinc-400 text-sm">Skipped (Existing)</span>
                  <span className="text-xl font-bold font-mono text-yellow-500">
                    {activeSession?.skippedCount || 0}
                  </span>
                </div>

                <div className="flex justify-between items-end border-b border-zinc-850 pb-2.5">
                  <span className="text-zinc-400 text-sm">Failed Streams</span>
                  <span className="text-xl font-bold font-mono text-red-500">
                    {activeSession?.failedCount || 0}
                  </span>
                </div>

                <div className="flex justify-between items-end border-b border-zinc-850 pb-2.5">
                  <span className="text-zinc-400 text-sm">Elapsed Duration</span>
                  <span className="text-xl font-bold font-mono text-zinc-200">
                    {activeSession 
                      ? `${Math.floor(activeSession.elapsedSeconds / 60)}m ${(activeSession.elapsedSeconds % 60).toString().padStart(2, '0')}s` 
                      : "00m 00s"
                    }
                  </span>
                </div>

                <div className="flex justify-between items-end pb-1">
                  <span className="text-zinc-400 text-sm">Estimated Finish</span>
                  <span className="text-sm font-mono font-black text-red-400 animate-pulse">
                    {getEstimatedFinishTime()}
                  </span>
                </div>
              </div>

              <div className="mt-8 pt-5 border-t border-zinc-800">
                <button 
                  onClick={handleExportScript}
                  className="w-full py-3.5 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all duration-250 flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95"
                  id="open-script-btn"
                >
                  <FileCode className="h-4 w-4" />
                  <span>View Compiled Script</span>
                </button>
              </div>
            </div>

            {/* Local execution tutorial / security notice */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between" id="tutorial-bento-card">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 block mb-3">
                  How Local yt-dlp works
                </span>
                <h4 className="text-sm font-bold text-white mb-2">Execute on your local machine</h4>
                <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                  For actual local execution on your device without server limits, click the script compiler button. You'll get a fully functioning single-file Python script tailored to your playlist and selected video indices.
                </p>

                <div className="space-y-2.5">
                  <div className="flex items-start gap-3 bg-zinc-950 p-2.5 rounded-xl border border-zinc-850">
                    <span className="font-mono text-xs text-red-400 bg-red-950/30 px-1.5 py-0.5 rounded border border-red-900/30 font-bold">1</span>
                    <p className="text-[11px] text-zinc-400 leading-tight">Install Python and run: <br /><code className="text-zinc-200 select-all font-mono">pip install yt-dlp</code></p>
                  </div>
                  <div className="flex items-start gap-3 bg-zinc-950 p-2.5 rounded-xl border border-zinc-850">
                    <span className="font-mono text-xs text-red-400 bg-red-950/30 px-1.5 py-0.5 rounded border border-red-900/30 font-bold">2</span>
                    <p className="text-[11px] text-zinc-400 leading-tight">Paste compiled script into a file called <code className="text-zinc-200 font-mono">downloader.py</code></p>
                  </div>
                  <div className="flex items-start gap-3 bg-zinc-950 p-2.5 rounded-xl border border-zinc-850">
                    <span className="font-mono text-xs text-red-400 bg-red-950/30 px-1.5 py-0.5 rounded border border-red-900/30 font-bold">3</span>
                    <p className="text-[11px] text-zinc-400 leading-tight">Run: <code className="text-zinc-200 select-all font-mono">python downloader.py</code> to download files directly!</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-zinc-800 flex items-center gap-2 text-xs text-zinc-500 font-mono justify-center">
                <Monitor className="h-3.5 w-3.5 text-zinc-650" />
                <span>Compatible with Linux, macOS & Windows</span>
              </div>
            </div>

          </div>

        </div>

        {/* Channel Auto-Watch Panel */}
        <WatchPanel />

      </div>

      {/* Footer - Copyright */}
      <footer className="mt-12 text-center text-xs text-zinc-600 max-w-7xl mx-auto w-full pt-6 border-t border-zinc-900 font-mono">
        <p>© 2026 YouTube Playlist Downloader Client. Fully compliant with yt_dlp concurrency profiles.</p>
        <p className="mt-1">Generated and packaged inside the modern Cloud sandbox.</p>
      </footer>

      {/* Script Compilation Modal popup */}
      {showScriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn" id="script-export-modal">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            
            {/* Header */}
            <div className="p-5 border-b border-zinc-800 bg-zinc-950/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center border border-emerald-500/20">
                  <FileCode className="h-4 w-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Your Compiled Python Downloader</h3>
                  <p className="text-xs text-zinc-500">Fully configured with indices, quality settings, and concurrency filters.</p>
                </div>
              </div>
              
              <button 
                onClick={() => setShowScriptModal(false)}
                className="text-zinc-400 hover:text-white bg-zinc-850 hover:bg-zinc-850 px-3 py-1.5 rounded-lg text-xs transition-colors border border-zinc-800 cursor-pointer"
                id="close-modal-btn"
              >
                Close
              </button>
            </div>

            {/* Code Body */}
            <div className="p-6 bg-zinc-950 font-mono text-xs text-zinc-300 overflow-y-auto flex-grow relative">
              <div className="absolute top-4 right-4 z-10">
                <button 
                  onClick={handleCopyScript}
                  className="bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer text-[11px]"
                  id="copy-script-btn"
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy Code</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="select-all leading-relaxed whitespace-pre-wrap">{exportedScript}</pre>
            </div>

            {/* Footer action */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2 text-zinc-500">
                <AlertCircle className="h-4 w-4 text-amber-500/85 shrink-0" />
                <span>Make sure to run pip install yt-dlp before executing locally.</span>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setShowScriptModal(false)}
                  className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCopyScript}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Copy to Clipboard
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
