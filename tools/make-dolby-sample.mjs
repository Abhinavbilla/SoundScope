// Make test files whose sound is Dolby Digital, like many movie MKVs, using Mediabunny's AC-3 extension
// (no ffmpeg needed). The sound is re-encoded; a video's picture is copied as it is. Runs in Edge or Chrome
// because decoding the source sound needs WebCodecs.
// Usage: node tools/make-dolby-sample.mjs <input audio or video> <output .mkv or .mp4> [ac3|eac3] [sound file]
//   sound file: use this file's sound instead (e.g. for a video that has none), cut to the video's length
// Env: SS_BROWSER=msedge|chrome
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const [input, output, codec = "ac3", sound] = process.argv.slice(2);
if (!input || !output) {
  console.log("Usage: node tools/make-dolby-sample.mjs <input> <output.mkv|.mp4> [ac3|eac3]");
  process.exit(1);
}
const root = path.resolve("node_modules");
const files = {
  "/mediabunny.mjs": path.join(root, "mediabunny/dist/bundles/mediabunny.mjs"),
  "/ac3.mjs": path.join(root, "@mediabunny/ac3/dist/bundles/mediabunny-ac3.mjs"),
};
const page = `<!doctype html><script type="importmap">{"imports":{"mediabunny":"/mediabunny.mjs"}}</script>`;
const server = http.createServer((req, res) => {
  const file = files[req.url];
  if (file) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(page);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: process.env.SS_BROWSER || "msedge" });
try {
  const tab = await browser.newPage();
  await tab.goto(base + "/");
  await tab.setContent(page + `<input type="file" id="f"><input type="file" id="s">`);
  await tab.setInputFiles("#f", input);
  if (sound) await tab.setInputFiles("#s", sound);
  const bytes = await tab.evaluate(async ({ codec, mkv }) => {
    const mb = await import("mediabunny");
    const { registerAc3Encoder } = await import("/ac3.mjs");
    registerAc3Encoder();
    const open = (id) => new mb.Input({ source: new mb.BlobSource(document.getElementById(id).files[0]), formats: mb.ALL_FORMATS });
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: mkv ? new mb.MkvOutputFormat() : new mb.Mp4OutputFormat(), target });
    if (!document.getElementById("s").files.length) {
      const conversion = await mb.Conversion.init({
        input: open("f"),
        output,
        video: { forceTranscode: false },
        audio: { codec, bitrate: 192_000, forceTranscode: true },
      });
      if (!conversion.isValid) throw new Error(JSON.stringify(conversion.discardedTracks.map((t) => t.reason)));
      await conversion.execute();
      return [...new Uint8Array(target.buffer)];
    }
    // picture from the first file (copied), sound from the second (encoded), cut to the picture's length
    const video = await open("f").getPrimaryVideoTrack();
    const audio = await open("s").getPrimaryAudioTrack();
    const end = await video.computeDuration();
    const pictures = new mb.EncodedVideoPacketSource(await video.getCodec());
    const sounds = new mb.AudioSampleSource({ codec, bitrate: 192_000 });
    output.addVideoTrack(pictures);
    output.addAudioTrack(sounds);
    await output.start();
    const decoderConfig = await video.getDecoderConfig();
    let first = true;
    for await (const packet of new mb.EncodedPacketSink(video).packets()) {
      await pictures.add(packet, first ? { decoderConfig } : undefined);
      first = false;
    }
    for await (const sample of new mb.AudioSampleSink(audio).samples(0, end)) {
      await sounds.add(sample);
      sample.close();
    }
    await output.finalize();
    return [...new Uint8Array(target.buffer)];
  }, { codec, mkv: output.toLowerCase().endsWith(".mkv") });
  fs.writeFileSync(output, Buffer.from(bytes));
  console.log(`${output}: ${(bytes.length / 1e6).toFixed(1)} MB, sound ${codec}`);
} finally {
  await browser.close();
  server.close();
}
