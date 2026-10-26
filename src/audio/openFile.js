// Open and analyse an audio file. If this exact file (name, size, last modified) was analysed
// before, its saved result is loaded from OPFS instead. Otherwise the worker reads, decodes and
// scores the file chunk by chunk (any length) and saves full-resolution scores to OPFS; the page
// only keeps a 1-second overview, the per-sound maximum and waveform peaks. If the worker can't
// read the format, the browser's whole-file decoder runs here and the samples go to the worker.
import { decodeToMono, DecodeError } from "./decode.js";
import { MODEL } from "../model/config.js";
import { BLOCK_ROWS, loadResult, readAll, resultKey, storeSupported, touchResult } from "../store/scoreStore.js";

const PEAKS_PER_SECOND = 20; // keep in sync with analysis.worker.js
const CLASSES = MODEL.labels.length;
// The whole-file fallback needs ~55-60 MB of memory per minute of stereo audio (measured in Edge),
// and failed above ~45 min on the test machine. Refuse obviously huge files up front.
const FALLBACK_MAX_BYTES = 200 * 1024 * 1024;

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|ts|mts|m2ts|avi|wmv|flv|3gp|mpg|mpeg)$/i;

/** Video container by type or name. Videos never use the whole-file fallback (it would load the whole video). */
export function looksLikeVideo(file) {
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.test(file.name);
}

/**
 * @param {File} file
 * @param {{onInfo?: Function, onProgress?: Function, onModel?: Function, onOverview?: Function,
 *          collect?: boolean, analyse?: boolean, reuse?: boolean}} handlers
 *   onModel({stage: "downloading", loaded, total} | {stage: "ready", fromCache})
 *   onOverview(rows: Uint8Array) new 1-second overview rows (rows x classes), for live results
 * @returns {{promise: Promise<object>, cancel: () => void}}
 *   Result: { duration, channels, hasVideo, peaks, peaksPerSecond, overview, classMax, classes,
 *             store: { key, meta, stored, reason }, path: "stream" | "fallback" | "saved", timings }
 *   Full-resolution timelines: readClass(store.key, store.meta, classIndex) from scoreStore.js.
 */
export function openAudioFile(file, { onInfo, onProgress, onModel, onOverview, collect = false, analyse = true, reuse = true } = {}) {
  let worker = null;
  let cancelled = false;
  let rejectFn;

  const promise = new Promise((resolve, reject) => {
    rejectFn = reject;
    const peakParts = [];
    const overviewParts = [];
    let path = "stream";
    let key = null;

    let firstStart = null, retried = false; // the stream start message, kept for one retry

    function startWorker(message, transfer = []) {
      if (message.type === "start") firstStart = message;
      worker = new Worker(new URL("../workers/analysis.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => handle(data);
      worker.onerror = (e) => {
        worker.terminate();
        reject(new DecodeError("unsupported", "Something went wrong while analysing this file. Reload the page and try again.", e.message));
      };
      worker.postMessage(message, transfer);
    }

    async function handle(data) {
      switch (data.type) {
        case "info":
          onInfo?.(data);
          break;
        case "model-progress":
          onModel?.({ stage: "downloading", loaded: data.loaded, total: data.total });
          break;
        case "model-ready":
          onModel?.({ stage: "ready", fromCache: data.fromCache });
          break;
        case "progress":
          peakParts.push(data.peaks);
          if (data.overview.length) {
            overviewParts.push(data.overview);
            onOverview?.(data.overview);
          }
          onProgress?.(data.seconds);
          break;
        case "done": {
          worker.terminate();
          overviewParts.push(data.overviewTail);
          const meta = data.stored
            ? { rows: data.rows, classes: CLASSES, blockRows: BLOCK_ROWS, stepSeconds: MODEL.stepSeconds }
            : null;
          const result = {
            duration: data.seconds,
            channels: data.channels,
            hasVideo: !!data.hasVideo,
            codec: data.codec ?? null,
            peaks: concat(Float32Array, peakParts),
            peaksPerSecond: PEAKS_PER_SECOND,
            overview: concat(Uint8Array, overviewParts),
            classMax: data.classMax,
            classes: CLASSES,
            store: { key, meta, stored: data.stored, reason: data.storeReason },
            path,
            timings: data.timings,
            samples: data.samples,
          };
          // test only: rebuild the full score matrix from storage to verify it (short files)
          if (collect && meta) result.scores = await readAll(key, meta);
          resolve(result);
          break;
        }
        case "error": {
          worker.terminate();
          const video = data.hasVideo || looksLikeVideo(file);
          if (data.kind === "model" && /out of memory/i.test(data.detail) && firstStart && !retried) {
            // Safari can refuse the memory the multi-threaded engine asks for: try once more with one thread
            retried = true;
            peakParts.length = 0;
            overviewParts.length = 0;
            startWorker({ ...firstStart, threads: 1 });
          } else if (data.kind === "model") reject(new DecodeError("model", data.message, data.detail));
          else if (data.kind === "no-audio") reject(new DecodeError("empty", data.message, data.detail));
          // the browser's whole-file decoder can't read Dolby either, so its message is the useful one
          else if (data.kind === "codec" && (video || data.codec === "ac3" || data.codec === "eac3")) {
            reject(new DecodeError("unsupported", data.message, data.detail));
          }
          else if (video && data.kind === "unreadable") {
            reject(new DecodeError("unsupported",
              "This kind of video can't be opened. SoundScope opens MP4, MOV, WebM, MKV and TS videos.", data.detail));
          } else if (data.kind === "unreadable" || data.kind === "codec") await fallback(data);
          else reject(new DecodeError("unsupported", data.message, data.detail));
          break;
        }
      }
    }

    async function fallback(data) {
      if (file.size > FALLBACK_MAX_BYTES && !globalThis.__soundscopeForceFallback) {
        reject(new DecodeError("unsupported", data.oldBrowser ? data.message // e.g. old Safari: updating is the fix
          : "This kind of file can't be opened in this browser. Try converting it to MP3 or MP4.", data.detail));
        return;
      }
      path = "fallback";
      try {
        const audio = await decodeToMono(file);
        if (cancelled) return;
        onInfo?.({ duration: audio.duration, channels: audio.channels });
        startWorker({ type: "start-samples", samples: audio.samples, channels: audio.channels, collect, analyse,
          store: storeOptions(), file, threads: globalThis.__soundscopeThreads, modelUrl: globalThis.__soundscopeModelUrl,
          modelSha256: globalThis.__soundscopeModelSha256 });
      } catch (e) {
        reject(e);
      }
    }

    function storeOptions() {
      // test only: __soundscopeNoStore (as if OPFS were missing), __soundscopeNoSpace (as if storage were full)
      return { key, disabled: !key || !!globalThis.__soundscopeNoStore, forceNoSpace: !!globalThis.__soundscopeNoSpace };
    }

    async function start() {
      if (analyse && storeSupported()) {
        try {
          key = await resultKey(file, MODEL.id);
        } catch {
          key = null; // e.g. crypto.subtle unavailable outside a secure context
        }
      }
      if (cancelled) return;
      if (key && reuse && !globalThis.__soundscopeNoStore) {
        const t0 = performance.now();
        const saved = await loadResult(key);
        if (cancelled) return;
        if (saved && saved.meta.modelId === MODEL.id) {
          touchResult(key, saved.meta);
          const result = fromSaved(saved, performance.now() - t0);
          if (collect) result.scores = await readAll(key, saved.meta);
          resolve(result);
          return;
        }
      }
      if (globalThis.__soundscopeForceFallback) {
        // test only: compare against the whole-file decoder under the same conditions
        fallback({ detail: "forced fallback" });
      } else {
        startWorker({ type: "start", file, collect, analyse, store: storeOptions(), threads: globalThis.__soundscopeThreads,
          modelUrl: globalThis.__soundscopeModelUrl, // test only: __soundscopeModelUrl, __soundscopeModelSha256, __soundscopeNoStreamReader
          modelSha256: globalThis.__soundscopeModelSha256,
          streamReader: !globalThis.__soundscopeNoStreamReader });
      }
    }

    start().catch(reject);
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      worker?.terminate();
      rejectFn?.(new DOMException("Cancelled", "AbortError"));
    },
  };
}

function fromSaved({ key, meta, overview, peaks }, loadMs) {
  const classMax = new Uint8Array(meta.classes);
  for (let i = 0; i < overview.length; i += meta.classes) {
    for (let c = 0; c < meta.classes; c++) if (overview[i + c] > classMax[c]) classMax[c] = overview[i + c];
  }
  return {
    duration: meta.duration,
    channels: meta.channels,
    hasVideo: !!meta.hasVideo,
    codec: meta.codec ?? null, // results saved before this was recorded have none
    peaks,
    peaksPerSecond: meta.peaksPerSecond,
    overview,
    classMax,
    classes: meta.classes,
    store: { key, meta, stored: true, reason: null },
    path: "saved",
    timings: { totalMs: loadMs },
  };
}

function concat(Type, parts) {
  const out = new Type(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
