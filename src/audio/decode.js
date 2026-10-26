// Decode an audio file on the main thread into mono Float32 samples at the model's rate.
// Fallback only: the normal path streams the file in the worker (see stream.js).
// decodeAudioData isn't available in workers, so this has to run here.

import { MODEL } from "../model/config.js";

export const TARGET_SAMPLE_RATE = MODEL.sampleRate;

export class DecodeError extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind; // "unsupported" | "memory" | "empty"
    this.cause = cause;
  }
}

const TOO_LONG_MESSAGE =
  "This recording is too long to open in this browser on this device (it ran out of memory). " +
  "Try a shorter file, or close other tabs and apps and try again.";

const PROBE_MIN_FILE_BYTES = 8 * 1024 * 1024;
const PROBE_BYTES = 1024 * 1024;

/** True if the first 1 MB of a large file decodes, i.e. the file itself looks fine. */
async function startDecodes(file) {
  if (file.size < PROBE_MIN_FILE_BYTES) return false;
  try {
    const head = await file.slice(0, PROBE_BYTES).arrayBuffer();
    await new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE).decodeAudioData(head);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {File} file
 * @param {(stage: "reading" | "decoding" | "mixing") => void} [onStage]
 * @returns {Promise<{samples: Float32Array, sampleRate: number, duration: number,
 *   channels: number, timings: {readMs: number, decodeMs: number, mixMs: number}}>}
 */
export async function decodeToMono(file, onStage) {
  if (file.size === 0) throw new DecodeError("empty", "This file is empty. Choose another file.");

  onStage?.("reading");
  let t = performance.now();
  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch (e) {
    throw new DecodeError("memory", "The browser couldn't load this file into memory. It may be too large. Close other tabs and try again, or try a shorter file.", e);
  }
  const readMs = performance.now() - t;

  // decodeAudioData on an OfflineAudioContext resamples to the context's rate,
  // so decoding and resampling to the model's rate happen in one step.
  onStage?.("decoding");
  t = performance.now();
  let buffer;
  try {
    const ctx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
    buffer = await ctx.decodeAudioData(bytes); // detaches `bytes`
  } catch (e) {
    // Edge reports running out of memory as the same EncodingError as a damaged file.
    // If the start of a large file decodes fine, the format is OK and the length is the problem.
    if (e instanceof RangeError || /memory|alloc/i.test(String(e?.message)) || (await startDecodes(file))) {
      throw new DecodeError("memory", TOO_LONG_MESSAGE, e);
    }
    throw new DecodeError(
      "unsupported",
      "This file couldn't be read. It may be damaged, or in a format this browser can't play. Try converting it to MP3 or MP4.",
      e,
    );
  }
  bytes = null;
  const decodeMs = performance.now() - t;

  // Mix down to mono in place in channel 0, so we never hold a third full-length copy.
  onStage?.("mixing");
  t = performance.now();
  const channels = buffer.numberOfChannels;
  const samples = buffer.getChannelData(0);
  if (channels > 1) {
    for (let c = 1; c < channels; c++) {
      const other = buffer.getChannelData(c);
      for (let i = 0; i < samples.length; i++) samples[i] += other[i];
    }
    const scale = 1 / channels;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }
  const mixMs = performance.now() - t;

  if (samples.length === 0) throw new DecodeError("empty", "This file has no sound in it. Choose another file.");

  return {
    samples,
    sampleRate: TARGET_SAMPLE_RATE,
    duration: samples.length / TARGET_SAMPLE_RATE,
    channels,
    timings: { readMs, decodeMs, mixMs },
  };
}
