// When the browser's own player can't play a file's container (MKV in Safari, MPEG-TS in Chrome), a copy
// it can play is made in a worker (playable.worker.js: the same picture and sound as MP4, not re-encoded)
// and played instead. The analysis, bookmarks and clips keep using the original file.
const DIR = "playable"; // keep in sync with playable.worker.js

// The sound formats an MP4 can carry, as the player's type strings.
const AUDIO_TYPES = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: 'audio/mp4; codecs="mp4a.6B"',
  opus: 'audio/mp4; codecs="opus"',
  flac: 'audio/mp4; codecs="flac"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
};

function playableCodecs() {
  const audio = document.createElement("audio");
  const out = {};
  for (const [codec, type] of Object.entries(AUDIO_TYPES)) {
    out[codec] = !!globalThis.MediaSource?.isTypeSupported?.(type) || audio.canPlayType(type) !== "";
  }
  return out;
}

async function copyKey(file) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${file.name}|${file.size}|${file.lastModified}`));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Make (or reuse) a playable copy of `file`.
 * @returns {{ promise: Promise<Blob>, cancel(): void }} the promise rejects with an Error whose message
 *   is written for people (it's shown before "The sounds found are complete...")
 */
export function makePlayableCopy(file, onProgress) {
  let worker = null, cancelled = false;
  const promise = (async () => {
    const key = await copyKey(file);
    if (cancelled) throw new DOMException("Cancelled", "AbortError");
    return new Promise((resolve, reject) => {
      worker = new Worker(new URL("../workers/playable.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = async ({ data }) => {
        if (data.type === "progress") { onProgress?.(data.value); return; }
        worker.terminate();
        if (data.type === "error") { reject(new Error(data.message)); return; }
        try {
          const mime = file.type.startsWith("audio/") ? "audio/mp4" : "video/mp4";
          if (data.bytes) { resolve(new Blob([data.bytes], { type: mime })); return; }
          const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR);
          const copy = await (await dir.getFileHandle(`${key}.mp4`)).getFile();
          resolve(copy.slice(0, copy.size, mime));
        } catch {
          reject(new Error("This browser can't play this file, so the timeline won't play it."));
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error("Something went wrong while preparing this file for playback. Open the file again to try again."));
      };
      worker.postMessage({ file, key, playable: playableCodecs() });
    });
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      worker?.terminate();
    },
  };
}

/** Delete playable copies (they can always be made again). Best effort. */
export async function clearPlayableCopies() {
  try {
    await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true });
  } catch {
    // none, or no OPFS
  }
}
