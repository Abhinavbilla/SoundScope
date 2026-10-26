// Export bookmarks: a CSV, and WAV clips (one file per clip, no zip). Clips are cut in a worker that
// decodes only the seconds each clip needs.
import { formatTime } from "../results/format.js";
import { encodeWav } from "./wav.js";

export const CLIP_PADDING = 1; // seconds added before and after each clip
const WHOLE_FILE_MAX_BYTES = 200 * 1024 * 1024; // same limit as the analysis fallback

/** CSV for Excel (UTF-8 with BOM): start and end as m:ss.s and in seconds, sound, note, score 0..1. */
export function bookmarksCsv(bookmarks) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["Start", "End", "Sound", "Note", "Start (seconds)", "End (seconds)", "Score (0 to 1)"].join(",")];
  for (const b of bookmarks) {
    lines.push([formatTime(b.start), formatTime(b.end), b.label || "Your bookmark", b.note, b.start.toFixed(3), b.end.toFixed(3),
      b.confidence == null ? "" : b.confidence.toFixed(3)]
      .map(cell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

const baseName = (name) => name.replace(/\.[^.]+$/, "");
const safe = (s) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").replace(/,/g, "").slice(0, 60);

export function csvName(fileName) {
  return `${safe(baseName(fileName))}-bookmarks.csv`;
}

/** A note, short enough for a file name: its first 5 words, at most 40 characters, cut at a word. */
function noteForName(note) {
  const ws = safe(note ?? "").split("-").filter(Boolean).slice(0, 5);
  let out = "";
  for (const w of ws) {
    if ((out ? out.length + 1 : 0) + w.length > 40) break;
    out = out ? `${out}-${w}` : w;
  }
  return out || (ws[0] ?? "").slice(0, 40);
}

/**
 * e.g. "walk-Bark-0-24.9.wav", or with a note "walk-Bark-neighbours-dog-0-24.9.wav" (time of the
 * bookmark's start, without padding).
 */
export function clipName(fileName, b) {
  const t = formatTime(b.start).replace(/:/g, "-");
  const note = noteForName(b.note);
  return `${safe(baseName(fileName))}-${safe(b.label || "bookmark")}${note ? `-${note}` : ""}-${t}.wav`;
}

/** Save one file through the browser's download. */
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A clip problem with a message written for people (anything else is shown as a general message). */
export class ClipError extends Error {}

/** Saving a clip failed: the disk is full, or the folder can't be written to. */
function saveFailed(e) {
  return new ClipError(e?.name === "QuotaExceededError"
    ? "There isn't enough free space. Free up some space and try again."
    : "SoundScope couldn't save to that folder. Try again, or choose another folder.");
}

/**
 * Cut clips (bookmark +/- CLIP_PADDING, kept inside the file) and hand each WAV to `save(name, bytes)`.
 * @returns {Promise<void>} rejects with a ClipError if the file can't be cut or a clip can't be saved
 */
export function makeClips(file, bookmarks, duration, save, onProgress) {
  if (globalThis.__soundscopeForceFallback) { // test only: the whole-file path
    const clips = bookmarks.map((b) => ({
      id: b.id, start: Math.max(0, b.start - CLIP_PADDING), end: Math.min(duration, b.end + CLIP_PADDING),
    }));
    return clipsFromWholeFile(file, clips, new Map(bookmarks.map((b) => [b.id, b])), save, onProgress);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/clip.worker.js", import.meta.url), { type: "module" });
    const byId = new Map(bookmarks.map((b) => [b.id, b]));
    const clips = bookmarks.map((b) => ({
      id: b.id, start: Math.max(0, b.start - CLIP_PADDING), end: Math.min(duration, b.end + CLIP_PADDING),
    }));
    let done = 0;
    let queue = Promise.resolve(); // handle messages one after another: a save may take a while
    const fail = (e) => {
      worker.terminate();
      reject(e instanceof ClipError ? e : new ClipError("Something went wrong while cutting the sound. Please try again.", { cause: e }));
    };
    worker.onmessage = ({ data }) => {
      queue = queue.then(async () => {
        if (data.type === "clip") {
          await save(clipName(file.name, byId.get(data.id)), data.wav).catch((e) => { throw saveFailed(e); });
          onProgress?.(++done, clips.length);
        } else if (data.type === "done") {
          worker.terminate();
          resolve();
        } else {
          worker.terminate();
          // A format only the browser's own decoder reads (small files only, like the analysis fallback)
          if (data.open && done === 0 && file.size <= WHOLE_FILE_MAX_BYTES) {
            await clipsFromWholeFile(file, clips, byId, save, onProgress);
            resolve();
          } else reject(new ClipError(data.message)); // the worker's messages are written for people
        }
      }).catch(fail);
    };
    worker.onerror = (e) => fail(e);
    worker.postMessage({ file, clips });
  });
}

async function clipsFromWholeFile(file, clips, byId, save, onProgress) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer()).catch((e) => {
    throw new ClipError("This file can't be cut into clips in this browser. Try converting it to MP3 or MP4.", { cause: e });
  });
  const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c));
  let done = 0;
  for (const clip of clips) {
    const a = Math.round(clip.start * buf.sampleRate), b = Math.round(clip.end * buf.sampleRate);
    await save(clipName(file.name, byId.get(clip.id)), encodeWav(chans.map((ch) => ch.slice(a, b)), buf.sampleRate))
      .catch((e) => { throw saveFailed(e); });
    onProgress?.(++done, clips.length);
  }
}

/**
 * Where clips go: with several clips and the File System Access API (Chrome, Edge), into a folder
 * the user picks once; otherwise one download per clip.
 * @returns {Promise<((name: string, bytes: Uint8Array) => Promise<void>) | null>} null if the user cancelled
 */
export async function clipSaver(count) {
  if (count > 1 && window.showDirectoryPicker) {
    let dir;
    try {
      dir = await window.showDirectoryPicker({ mode: "readwrite", id: "soundscope-clips" });
    } catch (e) {
      if (e?.name === "AbortError") return null;
      dir = null; // not allowed here: fall back to downloads
    }
    if (dir) {
      return async (name, bytes) => {
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await w.write(bytes);
        await w.close();
      };
    }
  }
  return async (name, bytes) => {
    download(name, bytes, "audio/wav");
    await new Promise((r) => setTimeout(r, 300)); // browsers drop downloads started too close together
  };
}
