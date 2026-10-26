// Decodes a file chunk by chunk into mono at the model's rate, runs the model on windows, and
// saves the full-resolution scores to OPFS as it goes (scoreStore.js). The page only receives
// waveform peaks, a 1-second overview and the per-sound maximum, so page memory stays flat
// for any file length. Audio is dropped after each chunk.
import { monoBlocks, openAudio, StreamError } from "../audio/stream.js";
import { MODEL } from "../model/config.js";
import { loadModel, makeInput, setThreads } from "../model/loadModel.js";
import { WindowScorer } from "../model/scorer.js";
import { createWriter, ensureSpace, removeUnfinished, scoreBytes, storeSupported } from "../store/scoreStore.js";

const PEAKS_PER_SECOND = 20; // keep in sync with openFile.js
const PEAK_SIZE = MODEL.sampleRate / PEAKS_PER_SECOND;
const PROGRESS_EVERY_MS = 250;
const BLOCK_SAMPLES = MODEL.sampleRate; // for pre-decoded input
const CLASSES = MODEL.labels.length;
const ROWS_PER_SECOND = Math.round(1 / MODEL.stepSeconds);

let model = MODEL; // test only: data.modelUrl loads the model from elsewhere (a local copy, or another model to compare)

self.onmessage = async ({ data }) => {
  setThreads(data.threads);
  if (data.modelUrl) {
    model = { ...MODEL, url: data.modelUrl, gzip: data.modelUrl.endsWith(".gz") };
    if (data.modelSha256) model.sha256 = data.modelSha256; // a different model file than the shipped one
  }
  if (data.type === "start") await analyseFile(data);
  else if (data.type === "start-samples") await analyseSamples(data);
};

function post(msg, transfer) {
  self.postMessage(msg, transfer ?? []);
}

class ModelError extends Error {}

/** Starts the model download/load right away; resolves to a run function. */
function startModel() {
  const t0 = performance.now();
  let lastPost = 0;
  return loadModel(model, (loaded, total) => {
    const now = performance.now();
    if (now - lastPost > 200 || loaded === total) {
      post({ type: "model-progress", loaded, total });
      lastPost = now;
    }
  }).then(({ session, fromCache, threads }) => {
    const loadMs = performance.now() - t0;
    post({ type: "model-ready", fromCache, threads, loadMs });
    let inferenceMs = 0;
    const runTimes = [];
    const rowValues = MODEL.rowsPerWindow * CLASSES;
    const run = async (samples) => {
      const t = performance.now();
      const out = await session.run(makeInput(MODEL, samples));
      const dt = performance.now() - t;
      inferenceMs += dt;
      runTimes.push(dt);
      const data = out[session.outputNames[0]].data;
      return data.length === rowValues ? data : data.subarray(0, rowValues);
    };
    const runStats = () => {
      const s = [...runTimes].sort((a, b) => a - b);
      const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0);
      return { windows: s.length, first: Math.round(runTimes[0] ?? 0), min: q(0), median: q(0.5), p90: q(0.9), max: q(1) };
    };
    return { run, loadMs, fromCache, threads, inferenceMs: () => inferenceMs, runStats };
  }).catch((e) => {
    throw new ModelError(String(e?.message ?? e));
  });
}

/**
 * Where full-resolution scores go. Persists to OPFS when it's available and there is room
 * (deleting old results if needed); otherwise only the overview is kept.
 */
async function openWriter(store, durationSeconds) {
  let persist = false, reason = null;
  if (!store?.key || store.disabled) reason = "disabled";
  else if (!storeSupported()) reason = "unsupported";
  else {
    const need = scoreBytes(Math.ceil(durationSeconds * ROWS_PER_SECOND), CLASSES) * 1.05;
    try {
      await removeUnfinished(store.key);
      persist = store.forceNoSpace ? false : await ensureSpace(need, store.key);
      if (!persist) reason = "no-space";
    } catch {
      reason = "unsupported";
    }
  }
  const writer = await createWriter({ key: store?.key, classes: CLASSES, rowsPerSecond: ROWS_PER_SECOND, persist });
  if (persist && !writer.persisted) reason = "locked";
  return { writer, reason: writer.persisted ? null : reason };
}

/** Shared loop: peaks + scores for a stream of mono blocks. */
async function analyseBlocks(blocks, modelPromise, writer, collect) {
  const runner = modelPromise ? await modelPromise : null; // null: decode only (device test)
  const scorer = runner ? new WindowScorer(MODEL, runner.run) : null;
  let samplesIn = 0, peakMax = 0, peakFill = 0;
  let peaks = []; // since the last progress message
  const allPeaks = []; // whole file, saved with the result
  let overviewParts = [];
  let lastPost = performance.now();
  const collected = collect ? [] : null; // test only: keep the audio to compare decoders

  const handleRows = (rows, final = false) => {
    if (rows.length && writer) overviewParts.push(writer.push(rows));
    const now = performance.now();
    if (final || now - lastPost > PROGRESS_EVERY_MS) {
      const p = Float32Array.from(peaks);
      const ov = concat(overviewParts);
      peaks = [];
      overviewParts = [];
      post({ type: "progress", seconds: samplesIn / MODEL.sampleRate, peaks: p, overview: ov }, [p.buffer, ov.buffer]);
      lastPost = now;
    }
  };

  for await (const block of blocks) {
    for (let i = 0; i < block.length; i++) {
      const v = Math.abs(block[i]);
      if (v > peakMax) peakMax = v;
      if (++peakFill === PEAK_SIZE) {
        peaks.push(peakMax);
        allPeaks.push(peakMax);
        peakMax = 0;
        peakFill = 0;
      }
    }
    samplesIn += block.length;
    if (collected) collected.push(block.slice());
    handleRows(scorer ? await scorer.push(block) : new Uint8Array(0));
  }
  if (peakFill) {
    peaks.push(peakMax);
    allPeaks.push(peakMax);
  }
  handleRows(scorer ? await scorer.flush() : new Uint8Array(0), true);

  let samples;
  if (collected) {
    samples = new Float32Array(samplesIn);
    let o = 0;
    for (const b of collected) { samples.set(b, o); o += b.length; }
  }
  return { seconds: samplesIn / MODEL.sampleRate, runner, samples, peaks: Float32Array.from(allPeaks) };
}

async function analyseFile({ file, collect, analyse = true, store, streamReader }) {
  const t0 = performance.now();
  const modelPromise = analyse ? startModel() : null;
  modelPromise?.catch(() => {}); // reported below when awaited
  let audio;
  try {
    audio = await openAudio(file, { streamReader }); // test only: streamReader
  } catch (e) {
    const kind = e instanceof StreamError ? e.kind : "unreadable";
    post({ type: "error", kind, message: e.message, detail: String(e.cause ?? e), codec: e.codec, hasVideo: e.hasVideo });
    return;
  }
  const openMs = performance.now() - t0;
  post({ type: "info", duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.channels,
    codec: audio.codec, hasVideo: audio.hasVideo });

  const { writer, reason } = analyse ? await openWriter(store, audio.duration) : { writer: null, reason: "decode-only" };
  let result;
  try {
    result = await analyseBlocks(monoBlocks(audio, MODEL.sampleRate), modelPromise, writer, collect);
  } catch (e) {
    post(errorFor(e));
    return;
  } finally {
    audio.input.dispose();
  }
  await finish(result, writer, reason, audio.channels, file,
    { openMs, totalMs: performance.now() - t0, bytesRead: audio.bytesRead(), fileBytes: file.size }, audio.hasVideo, audio.codec);
}

/** Fallback path: samples were decoded on the main thread. */
async function analyseSamples({ samples, channels, collect, analyse = true, store, file }) {
  const t0 = performance.now();
  const modelPromise = analyse ? startModel() : null;
  const { writer, reason } = analyse
    ? await openWriter(store, samples.length / MODEL.sampleRate)
    : { writer: null, reason: "decode-only" };
  async function* blocks() {
    for (let i = 0; i < samples.length; i += BLOCK_SAMPLES) yield samples.subarray(i, i + BLOCK_SAMPLES);
  }
  let result;
  try {
    result = await analyseBlocks(blocks(), modelPromise, writer, collect);
  } catch (e) {
    post(errorFor(e));
    return;
  }
  await finish(result, writer, reason, channels, file, { totalMs: performance.now() - t0 });
}

function errorFor(e) {
  if (e instanceof ModelError) {
    const offline = /fetch|network/i.test(e.message);
    return {
      type: "error", kind: "model", detail: e.message,
      message: offline
        ? "The first time, SoundScope needs the internet to download its sound finder (about 19 MB). Check your connection and try again."
        : "SoundScope couldn't start its sound finder. Reload the page and try again.",
    };
  }
  return { type: "error", kind: "unsupported", message: "This file couldn't be read. It may be damaged. Try converting it to MP3 or MP4 and opening it again.", detail: String(e) };
}

async function finish(result, writer, storeReason, channels, file, timings, hasVideo = false, codec = null) {
  const { runner } = result;
  const tSave = performance.now();
  const summary = writer
    ? await writer.finish({
      modelId: MODEL.id, stepSeconds: MODEL.stepSeconds, duration: result.seconds, channels,
      peaksPerSecond: PEAKS_PER_SECOND, fileName: file?.name, fileSize: file?.size, lastModified: file?.lastModified, hasVideo,
      codec, // the player needs it after a reopen: the browser may not play every sound format we can analyse
    }, result.peaks)
    : null;
  const msg = {
    type: "done",
    seconds: result.seconds,
    rows: summary?.rows ?? 0,
    channels,
    hasVideo,
    codec,
    classMax: summary?.classMax ?? null,
    overviewTail: summary?.overviewTail ?? new Uint8Array(0),
    stored: !!writer?.persisted,
    storeReason: writer?.failed ?? storeReason,
    timings: runner
      ? {
        ...timings,
        saveMs: performance.now() - tSave,
        modelLoadMs: runner.loadMs,
        inferenceMs: runner.inferenceMs(),
        windowMs: runner.runStats(),
        modelFromCache: runner.fromCache,
        threads: runner.threads,
      }
      : timings,
  };
  const transfer = [];
  if (result.samples) {
    msg.samples = result.samples;
    transfer.push(result.samples.buffer);
  }
  post(msg, transfer);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
