// Cuts clips out of the original file as WAV, decoding only the seconds each clip needs.
// Same file reading as the analysis (Mediabunny), at the file's own sample rate and channels
// (more than 2 channels are mixed down to stereo). Times are on the analysis timeline, so the MP3
// encoder delay that the analysis trims is added back here.
// Ogg Vorbis is read from the start instead of seeking, placing audio by counting decoded frames like
// the analysis does: Mediabunny's Vorbis timestamps were 7-23 ms off after a seek (a packet's length
// depends on the previous packet's block size, which a seek skips) and up to 5 ms off even without one.
// In:  { file, clips: [{ id, start, end }] }   Out: { type: "clip", id, wav } per clip, then { type: "done" }
//      or { type: "error", message, open } (open: the file couldn't be opened here at all)
import { AudioSampleSink, OGG } from "mediabunny";
import { openAudio, StreamError } from "../audio/stream.js";
import { encodeWav } from "../export/wav.js";

const LEAD_IN = 0.5; // seconds decoded before a clip and thrown away (a decoder starting mid-stream can glitch)

self.onmessage = async ({ data: { file, clips } }) => {
  let audio;
  try {
    audio = await openAudio(file);
  } catch (e) {
    // only our own messages are shown; anything else is a browser error, not written for people
    self.postMessage({ type: "error", open: true, message: e instanceof StreamError ? e.message : "This file can't be cut into clips in this browser. Try converting it to MP3 or MP4." });
    return;
  }
  try {
    const sink = new AudioSampleSink(audio.track);
    const sequential = audio.codec === "vorbis" && (await audio.input.getFormat()) === OGG;
    const jobs = clips.map((c) => newJob(c, audio));
    if (sequential) {
      // one pass from the start, filling every clip on the way
      const open = [...jobs].sort((a, b) => a.from - b.from);
      let pos = 0; // frames so far, after dropping anything before time 0 (as in monoBlocks)
      for await (const sample of sink.samples()) {
        try {
          const rate = sample.sampleRate;
          const skip = sample.timestamp < 0 ? Math.min(sample.numberOfFrames, Math.round(-sample.timestamp * rate)) : 0;
          const t0 = (pos - skip) / rate; // time of the sample's first frame
          pos += sample.numberOfFrames - skip;
          const t1 = pos / rate;
          for (const job of open) if (job.from < t1 && job.to > t0) add(job, sample, t0);
          while (open.length && open[0].to <= t1) send(open.shift()); // finished
          if (!open.length) break;
        } finally {
          sample.close();
        }
      }
      open.forEach(send); // clips running to the end of the file
    } else {
      for (const job of jobs) {
        for await (const sample of sink.samples(Math.max(0, job.from - LEAD_IN), job.to)) {
          try {
            add(job, sample);
          } finally {
            sample.close();
          }
        }
        send(job);
      }
    }
    self.postMessage({ type: "done" });
  } catch (e) {
    self.postMessage({ type: "error", message: "Something went wrong while cutting the sound. Please try again.", detail: String(e?.message ?? e) });
  } finally {
    audio.input.dispose();
  }
};

/** A clip being filled: media-time range and output channels. */
function newJob(clip, audio) {
  const rate = audio.sampleRate;
  const offset = audio.trim.start / rate; // analysis time 0 = media time `offset`
  const from = clip.start + offset, to = clip.end + offset;
  const outCh = Math.min(2, audio.channels);
  const n = Math.max(0, Math.round((to - from) * rate));
  return { id: clip.id, from, to, rate, out: Array.from({ length: outCh }, () => new Float32Array(n)) };
}

let scratch = new Float32Array(0);

/** Copy the part of `sample` that falls inside the clip (stereo or mono mix as needed). */
function add(job, sample, at = sample.timestamp) {
  const { out, rate, from } = job;
  const n = out[0].length, outCh = out.length;
  const first = Math.round((at - from) * rate); // index of the sample's first frame in `out`
  const a = Math.max(0, -first), b = Math.min(sample.numberOfFrames, n - first);
  if (b <= a) return;
  if (scratch.length < sample.numberOfFrames) scratch = new Float32Array(sample.numberOfFrames);
  const scale = sample.numberOfChannels > outCh ? outCh / sample.numberOfChannels : 1;
  for (let c = 0; c < sample.numberOfChannels; c++) {
    sample.copyTo(scratch, { planeIndex: c, format: "f32-planar" });
    const dst = out[outCh === 1 ? 0 : c % 2];
    for (let i = a; i < b; i++) dst[first + i] += scratch[i] * scale;
  }
}

function send(job) {
  const wav = encodeWav(job.out, job.rate);
  self.postMessage({ type: "clip", id: job.id, wav }, [wav.buffer]);
}
