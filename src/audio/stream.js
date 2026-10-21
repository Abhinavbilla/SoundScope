// Read an audio or video file piece by piece and yield mono blocks of its sound at the target rate.
// Only a small part of the file is ever in memory, so file length doesn't matter. For video files
// only the sound track is read and decoded; video frames are never decoded.
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import { Resampler } from "./resampler.js";

export class StreamError extends Error {
  /**
   * @param {"unreadable" | "no-audio" | "codec" | "unsupported"} kind
   *   unreadable: unknown container (the whole-file fallback may still work for audio files)
   *   codec: the sound track's codec can't be decoded in this browser (e.g. AC-3)
   */
  constructor(kind, message, cause, extra = {}) {
    super(message);
    this.kind = kind;
    this.cause = cause;
    Object.assign(this, extra); // { codec, hasVideo }
  }
}

const CODEC_NAMES = { ac3: "AC-3 (Dolby Digital)", eac3: "E-AC-3 (Dolby Digital Plus)", dts: "DTS" };

const MP3_DECODER_DELAY = 529;

/**
 * MP3 gapless info from the LAME/Lavc tag in the first frame: how many decoded samples to drop
 * at the start (encoder + decoder delay) and end (padding). Same trimming the browser's
 * whole-file decoder does. Returns zeros when there's no tag.
 */
async function mp3Trim(file) {
  const head = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer());
  let pos = 0;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    // ID3v2: 10-byte header, syncsafe size
    pos = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
    if (head[5] & 0x10) pos += 10; // footer
  }
  while (pos + 1 < head.length && !(head[pos] === 0xff && (head[pos + 1] & 0xe0) === 0xe0)) pos++;
  const tag = (s, at) => [...s].every((ch, i) => head[at + i] === ch.charCodeAt(0));
  for (let i = pos; i < Math.min(pos + 2048, head.length - 24); i++) {
    if (tag("LAME", i) || tag("Lavc", i) || tag("Lavf", i)) {
      const b = i + 21;
      const delay = (head[b] << 4) | (head[b + 1] >> 4);
      const padding = ((head[b + 1] & 0x0f) << 8) | head[b + 2];
      return { start: delay + MP3_DECODER_DELAY, end: Math.max(0, padding - MP3_DECODER_DELAY) };
    }
  }
  return { start: 0, end: 0 };
}

/**
 * Open the file and check that we can decode its sound track (the default one, for videos).
 * `streamReader: false` (test only) reads just the byte ranges the demuxer asks for instead of
 * streaming straight through the file.
 */
export async function openAudio(file, { streamReader = true } = {}) {
  const source = new BlobSource(file, { useStreamReader: streamReader });
  let bytesRead = 0;
  source.onread = (start, end) => { bytesRead += end - start; }; // how much of the file was read
  const input = new Input({ source, formats: ALL_FORMATS });
  let track, hasVideo = false;
  try {
    if (!(await input.canRead())) throw new StreamError("unreadable", "SoundScope doesn't recognise this kind of file.");
    hasVideo = !!(await input.getPrimaryVideoTrack()); // reads the track list only, no frames
    track = await input.getPrimaryAudioTrack(); // prefers the track marked as default
  } catch (e) {
    input.dispose();
    throw e instanceof StreamError ? e : new StreamError("unreadable", "Couldn't read this file.", e);
  }
  if (!track) {
    input.dispose();
    throw new StreamError("no-audio", hasVideo ? "This video has no sound." : "This file has no sound in it.",
      null, { hasVideo });
  }
  const codec = await track.getCodec();
  if (!(await track.canDecode())) {
    input.dispose();
    const name = CODEC_NAMES[codec] ?? codec ?? "this";
    throw new StreamError("codec",
      `This ${hasVideo ? "video's" : "file's"} sound is stored in a format (${name}) this browser can't play. Try Chrome or Edge, or convert the file to MP4 or MP3.`,
      null, { codec, hasVideo });
  }
  const duration = (await input.getDurationFromMetadata([track])) ?? (await input.computeDuration([track]));
  return {
    input,
    track,
    hasVideo,
    duration,
    sampleRate: await track.getSampleRate(),
    channels: await track.getNumberOfChannels(),
    codec,
    trim: codec === "mp3" ? await mp3Trim(file) : { start: 0, end: 0 },
    bytesRead: () => bytesRead,
  };
}

/**
 * Yields Float32Array blocks of mono audio at `targetRate`, roughly `blockSeconds` long.
 * @param {{track: any, trim: {start: number, end: number}}} audio from openAudio
 */
export async function* monoBlocks(audio, targetRate, blockSeconds = 1) {
  const sink = new AudioSampleSink(audio.track);
  let resampler = null;
  let pending = null; // mono input waiting to reach blockSeconds
  let pendingLen = 0;
  let scratch = new Float32Array(0);
  let startTrim = audio.trim.start; // source frames still to drop at the start
  const endTrim = audio.trim.end; // source frames to drop at the end: always held back in `pending`

  for await (const sample of sink.samples()) {
    try {
      const rate = sample.sampleRate;
      if (!resampler) {
        resampler = new Resampler(rate, targetRate);
        pending = new Float32Array(Math.ceil(rate * blockSeconds) + 16384);
      }
      // Skip frames before time 0 (encoder priming, which shouldn't be heard).
      let skip = sample.timestamp < 0 ? Math.min(sample.numberOfFrames, Math.round(-sample.timestamp * rate)) : 0;
      if (startTrim > 0) {
        const t = Math.min(startTrim, sample.numberOfFrames - skip);
        skip += t;
        startTrim -= t;
      }
      const frames = sample.numberOfFrames - skip;
      if (frames <= 0) continue;

      if (pendingLen + frames > pending.length) {
        const grown = new Float32Array((pendingLen + frames) * 2);
        grown.set(pending.subarray(0, pendingLen));
        pending = grown;
      }
      if (scratch.length < frames) scratch = new Float32Array(frames);
      const dst = pending.subarray(pendingLen, pendingLen + frames);
      const ch = sample.numberOfChannels;
      for (let c = 0; c < ch; c++) {
        sample.copyTo(scratch, { planeIndex: c, format: "f32-planar", frameOffset: skip, frameCount: frames });
        if (c === 0) dst.set(scratch.subarray(0, frames));
        else for (let i = 0; i < frames; i++) dst[i] += scratch[i];
      }
      if (ch > 1) for (let i = 0; i < frames; i++) dst[i] /= ch;
      pendingLen += frames;

      if (pendingLen - endTrim >= rate * blockSeconds) {
        const n = pendingLen - endTrim;
        const out = resampler.push(pending.subarray(0, n));
        pending.copyWithin(0, n, pendingLen); // keep the last endTrim frames back
        pendingLen = endTrim;
        if (out.length) yield out;
      }
    } finally {
      sample.close();
    }
  }
  if (resampler) {
    if (pendingLen > endTrim) {
      const out = resampler.push(pending.subarray(0, pendingLen - endTrim));
      if (out.length) yield out;
    }
    const tail = resampler.flush();
    if (tail.length) yield tail;
  }
}
