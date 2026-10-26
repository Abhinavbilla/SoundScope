// Makes a copy of a file that this browser's own player can play, for files whose container it can't
// (MKV in Safari, MPEG-TS in Chrome): the same picture and sound repackaged as MP4 without re-encoding.
// Sound the player can't play (e.g. Vorbis, or Dolby in Chrome) is converted to AAC. The copy is written to OPFS, so even a
// long movie never sits in memory; only one copy is kept (named by `key`, reused if it's complete).
// Without OPFS, files up to IN_MEMORY_MAX are copied into memory instead.
// In:  { file, key, playable: { [audioCodec]: boolean } }
// Out: { type: "progress", value } (0..1), then { type: "done", stored: true } (read it with
//      playableCopy.js) or { type: "done", bytes }, or { type: "error", message }
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, getFirstEncodableAudioCodec, Input, Mp4OutputFormat, Output, StreamTarget } from "mediabunny";

const DIR = "playable"; // keep in sync with playableCopy.js
const IN_MEMORY_MAX = 400 * 1024 * 1024;
const MARGIN = 100 * 1024 * 1024; // bytes of storage left free

const NO_SPACE = "There isn't enough free space to prepare this file for playback. Free up some space and open the file again.";
const CANT = "This browser can't play this file, so the timeline won't play it.";

self.onmessage = async ({ data: { file, key, playable } }) => {
  let handle = null, dir = null;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    // where the copy goes
    let target;
    if (navigator.storage?.getDirectory) {
      try {
        dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
        const names = [];
        for await (const [name] of dir.entries()) names.push(name);
        if (names.includes(`${key}.mp4`) && names.includes(`${key}.done`)) { self.postMessage({ type: "done", stored: true }); return; }
        for (const name of names) await dir.removeEntry(name).catch(() => {}); // only one copy is kept
        const { quota = 0, usage = 0 } = await navigator.storage.estimate();
        if (quota - usage < file.size + MARGIN) throw new Error("no space");
        handle = await (await dir.getFileHandle(`${key}.mp4`, { create: true })).createSyncAccessHandle();
        handle.truncate(0);
        target = new StreamTarget(new WritableStream({ write: ({ data, position }) => { handle.write(data, { at: position }); } }));
      } catch (e) {
        handle?.close();
        handle = null;
        if (e.message === "no space" && file.size > IN_MEMORY_MAX) { self.postMessage({ type: "error", message: NO_SPACE }); return; }
      }
    }
    if (!handle) {
      if (file.size > IN_MEMORY_MAX) { self.postMessage({ type: "error", message: CANT }); return; }
      target = new BufferTarget();
    }

    const sound = await input.getPrimaryAudioTrack();
    let audio = {};
    if (sound && !playable[await sound.getCodec()]) {
      if (["ac3", "eac3"].includes(await sound.getCodec()) && !(await sound.canDecode())) {
        const { registerAc3Decoder } = await import("@mediabunny/ac3"); // to convert Dolby sound
        registerAc3Decoder();
      }
      const channels = Math.min(2, sound.numberOfChannels);
      const codec = await getFirstEncodableAudioCodec(["aac", "opus"].filter((c) => playable[c]), { numberOfChannels: channels, sampleRate: 48000 });
      audio = codec ? { codec, numberOfChannels: channels, sampleRate: 48000, forceTranscode: true } : { discard: true };
    }
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat({ fastStart: handle ? false : "in-memory" }), target }),
      tracks: "primary",
      audio,
    });
    if (!conversion.isValid) { self.postMessage({ type: "error", message: CANT }); return; }
    conversion.onProgress = (value) => self.postMessage({ type: "progress", value });
    await conversion.execute();
    if (handle) {
      handle.flush();
      handle.close();
      handle = null;
      await dir.getFileHandle(`${key}.done`, { create: true }); // marks the copy as complete
      self.postMessage({ type: "done", stored: true });
    } else {
      const bytes = new Uint8Array(target.buffer);
      self.postMessage({ type: "done", bytes }, [bytes.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: "error", message: CANT, detail: String(e?.message ?? e) });
  } finally {
    if (handle) { handle.close(); await dir?.removeEntry(`${key}.mp4`).catch(() => {}); } // unfinished
    input.dispose();
  }
};
