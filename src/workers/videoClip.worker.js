// Cuts a video clip (picture and sound) out of the original file as MP4. The picture is copied as it is
// (no re-encoding: fast and the original quality); the clip starts at the key frame before `start` and
// is marked to play from `start`, which players follow. Sound the MP4 can't hold, or that most players
// can't play (Dolby Digital), is converted to AAC (Opus where the browser has no AAC encoder).
// In:  { file, start, end }   Out: { type: "progress", value } (0..1), then { type: "done", bytes }
//      or { type: "error", message }
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, getFirstEncodableAudioCodec, Input, Mp4OutputFormat, Output } from "mediabunny";

const DOLBY = ["ac3", "eac3"];
const CANT = "This browser can't make a video clip from this file. You can still download the sound clip.";

self.onmessage = async ({ data: { file, start, end } }) => {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const sound = await input.getPrimaryAudioTrack();
    let audio = {};
    if (sound && DOLBY.includes(await sound.getCodec())) {
      if (!(await sound.canDecode())) {
        const { registerAc3Decoder } = await import("@mediabunny/ac3");
        registerAc3Decoder();
      }
      const codec = await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: Math.min(2, sound.numberOfChannels), sampleRate: 48000 });
      // no encoder (e.g. older Safari): keep the Dolby sound as it is; Safari and Edge play it
      audio = codec ? { codec, numberOfChannels: Math.min(2, sound.numberOfChannels), sampleRate: 48000, forceTranscode: true } : {};
    }
    const target = new BufferTarget();
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target }),
      tracks: "primary",
      trim: { start, end },
      audio,
    });
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isVideoTrack())) {
      self.postMessage({ type: "error", message: CANT });
      return;
    }
    conversion.onProgress = (value) => self.postMessage({ type: "progress", value });
    await conversion.execute();
    const bytes = new Uint8Array(target.buffer);
    self.postMessage({ type: "done", bytes }, [bytes.buffer]);
  } catch (e) {
    const offline = /fetch|import|network/i.test(String(e?.message ?? e));
    self.postMessage({
      type: "error",
      message: offline
        ? "To make this clip, SoundScope needs to download a small extra part for Dolby sound. Check your internet connection and try again."
        : CANT,
      detail: String(e?.message ?? e),
    });
  } finally {
    input.dispose();
  }
};
