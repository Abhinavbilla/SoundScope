// Videos play with sound: open a video in the app, press play, and measure what the <video> element actually
// outputs (through captureStream, which copies the output). Needs `vite preview` on :4173.
// Usage: node tools/check-video-sound.mjs <video>
import { chromium } from "playwright-core";
const file = process.argv[2];
const b = await chromium.launch({ channel: "msedge", headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; // SS_LOCAL_MODEL=1
}, !!process.env.SS_LOCAL_MODEL);
page.on("console", (m) => console.log("  [console]", m.text().slice(0, 200)));
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 300000 });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  // listen to what the element outputs (captureStream copies the output, it doesn't take it over)
  const v = document.querySelector("video, audio");
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(v.captureStream ? v.captureStream() : v.mozCaptureStream());
  const an = ctx.createAnalyser();
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  window.__peak = 0;
  setInterval(() => { an.getFloatTimeDomainData(buf); for (const x of buf) window.__peak = Math.max(window.__peak, Math.abs(x)); }, 50);
  window.__ctxState = () => ctx.state;
});
await page.click(".play-btn");
await page.waitForTimeout(3000);
console.log("loudest output sample while playing:", await page.evaluate(() => window.__peak.toFixed(4)), "audio context:", await page.evaluate(() => window.__ctxState()));
const s = await page.evaluate(() => {
  const vids = [...document.querySelectorAll("video, audio")];
  return vids.map((v) => ({
    tag: v.tagName, inDom: document.contains(v), cls: v.className, muted: v.muted, volume: v.volume, paused: v.paused, t: v.currentTime,
    audioBytes: v.webkitAudioDecodedByteCount, videoBytes: v.webkitVideoDecodedByteCount,
    audioTracks: v.audioTracks ? v.audioTracks.length : "n/a", src: (v.src || v.currentSrc || "").slice(0, 40),
  }));
});
console.log(JSON.stringify(s, null, 1));
await b.close();
