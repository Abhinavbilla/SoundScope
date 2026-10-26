// Plays a video's Dolby Digital sound (AC-3 / E-AC-3), which most browsers' <video> can't: the sound is
// decoded here with Mediabunny's AC-3 extension (FFmpeg in its own worker) and played through Web Audio,
// following the <video>'s clock. The video keeps showing the picture; play, pause, seeking and speed
// changes all come from it. Loaded only for such files.
import { AudioBufferSink, BlobSource, Input, ALL_FORMATS } from "mediabunny";
import { registerAc3Decoder } from "@mediabunny/ac3";

const AHEAD = 1.5; // seconds of sound scheduled ahead of the playhead
const MAX_DRIFT = 0.12; // seconds: further apart than this, the sound restarts at the video's position

let registered = false;

/**
 * Start following `media` with the sound of `file`.
 * @returns {Promise<{ detach(): void }>} rejects if the sound can't be decoded here
 */
export async function attachDolbySound(file, media) {
  if (!registered) { registerAc3Decoder(); registered = true; }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error("sound track can't be decoded");
    const sink = new AudioBufferSink(track);
    const ctx = new AudioContext({ latencyHint: "playback" });
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const nodes = new Set();
    let run = 0; // bumped to stop the running schedule
    let clock = null; // { media, ctx, rate } while sound is playing
    // test only: is sound scheduled, how often it restarted, and does it keep time with the picture?
    const stats = globalThis.__soundscopeDebug ? { scheduled: 0, loudest: 0, starts: 0 } : null;
    if (stats) globalThis.__soundscopeDolby = {
      stats,
      drift: () => clock && media.currentTime - (clock.media + (ctx.currentTime - clock.ctx) * clock.rate),
    };
    const count = (buffer) => {
      stats.scheduled++;
      const d = buffer.getChannelData(0);
      for (let i = 0; i < d.length; i += 16) stats.loudest = Math.max(stats.loudest, Math.abs(d[i]));
    };

    const stop = () => {
      run++;
      clock = null;
      for (const n of nodes) { try { n.stop(); } catch { /* not started */ } }
      nodes.clear();
    };

    async function play() {
      stop();
      if (media.paused || media.ended) return;
      const me = run;
      if (stats) stats.starts++;
      await ctx.resume().catch(() => {});
      const rate = media.playbackRate || 1;
      let anchor = null; // { media, ctx, rate }: media time `media` is heard at context time `ctx`
      const latency = ctx.outputLatency || ctx.baseLatency || 0;
      try {
        for await (const { buffer, timestamp } of sink.buffers(media.currentTime)) {
          if (me !== run) return;
          // Anchor to the video once the first sound is ready, so decoding time doesn't shift it.
          if (!anchor) clock = anchor = { media: media.currentTime, ctx: ctx.currentTime, rate };
          const when = anchor.ctx + (timestamp - anchor.media) / rate - latency;
          let offset = 0, at = when;
          if (when < ctx.currentTime) { offset = (ctx.currentTime - when) * rate; at = ctx.currentTime; }
          if (offset < buffer.duration) {
            const node = ctx.createBufferSource();
            node.buffer = buffer;
            node.playbackRate.value = rate;
            node.connect(out);
            node.onended = () => nodes.delete(node);
            node.start(at, offset);
            nodes.add(node);
            if (stats) count(buffer);
          }
          // Wait while enough is scheduled, and keep checking the video hasn't drifted away.
          while (me === run && when - ctx.currentTime > AHEAD) {
            await new Promise((r) => setTimeout(r, 250));
            const expected = anchor.media + (ctx.currentTime - anchor.ctx) * rate;
            if (me === run && Math.abs(media.currentTime - expected) > MAX_DRIFT) { play(); return; }
          }
        }
      } catch {
        // e.g. the file went away: stay silent rather than break the page
      }
    }

    const events = { playing: play, seeked: play, ratechange: play, pause: stop, waiting: stop, seeking: stop, ended: stop };
    for (const [name, fn] of Object.entries(events)) media.addEventListener(name, fn);
    if (!media.paused) play();

    return {
      detach() {
        stop();
        for (const [name, fn] of Object.entries(events)) media.removeEventListener(name, fn);
        ctx.close().catch(() => {});
        input.dispose();
      },
    };
  } catch (e) {
    input.dispose();
    throw e;
  }
}
