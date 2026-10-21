// Time formats for the UI.

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A moment to a tenth of a second: 75.24 -> "1:15.2", 3725.2 -> "1:02:05.2" */
export function formatTime(seconds) {
  const t = Math.max(0, Math.floor(seconds * 10) / 10);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = (t % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** How long a sound is heard: 42 -> "42 s", 130 -> "2 min 10 s", 4000 -> "1 h 7 min" */
export function formatAmount(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(s / 3600)} h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)} min` : ""}`;
}

/** Rough time left for the analysis, in words: "About 2 min left", "Less than a minute left" */
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 15) return "Almost done";
  if (seconds < 60) return "Less than a minute left";
  if (seconds < 3600) return `About ${Math.round(seconds / 60)} min left`;
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return `About ${h} h${m ? ` ${m} min` : ""} left`;
}
