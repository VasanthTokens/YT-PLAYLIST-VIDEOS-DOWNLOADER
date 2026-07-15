export interface VideoMetadata {
  title: string;
  duration: number;
}

export interface PlaylistInfo {
  title: string;
  uploader: string;
  isSingleVideo: boolean;
  videos: VideoMetadata[];
  source?: "yt-dlp";
}

export interface DownloadTask {
  id: string;
  videoIndex: number;
  title: string;
  url: string;
  status: 'pending' | 'downloading' | 'finished' | 'skipped' | 'failed';
  progress: number;
  speed: string;
  sizeBytes: number;
}

export interface DownloadSession {
  id: string;
  playlistTitle: string;
  channel: string;
  folderName: string;
  quality: string;
  maxWorkers: number;
  tasks: DownloadTask[];
  status: 'running' | 'completed' | 'paused' | 'failed';
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  totalBytes: number;
  startTime: number;
  elapsedSeconds: number;
  logs: string[];
}

export const QUALITY_MAP: Record<string, { label: string; details: string }> = {
  "1": { label: "144p", details: "Extra low bandwidth (bv*[height<=144]+ba)" },
  "2": { label: "360p", details: "Standard mobile quality (bv*[height<=360]+ba)" },
  "3": { label: "720p", details: "High Definition HD (bv*[height<=720]+ba)" },
  "4": { label: "1080p", details: "Full High Definition FHD (bv*[height<=1080]+ba)" },
  "5": { label: "Best available", details: "Maximum possible quality (bv*+ba/b)" },
};
