// Rough cost of pulling one frame every 2 s from a video in the browser (seek a <video>, draw it at
// 224x224 on a canvas, read the pixels): what a sound + picture mode would do before running CLIP.
// Needs `vite preview` on :4173 (only for the page origin). Usage: node tools/measure-frame-grab.mjs <video> [frames]
import { chromium } from "playwright-core";

const [file, n = "60"] = process.argv.slice(2);
const b = await chromium.launch({ channel: "msedge", headless: false });
const page = await b.newPage();
await page.goto("http://localhost:4173/device-test.html");
await page.evaluate(() => {
  const i = document.createElement("input");
  i.type = "file";
  i.id = "grab";
  document.body.append(i);
});
await page.setInputFiles("#grab", file);
const r = await page.evaluate(async (n) => {
  const v = document.createElement("video");
  v.muted = true;
  v.src = URL.createObjectURL(document.getElementById("grab").files[0]);
  await new Promise((ok) => { v.onloadedmetadata = ok; });
  const c = new OffscreenCanvas(224, 224);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const t0 = performance.now();
  for (let k = 0; k < n; k++) {
    v.currentTime = 1 + 2 * k;
    await new Promise((ok) => { v.onseeked = ok; });
    ctx.drawImage(v, 0, 0, 224, 224);
    ctx.getImageData(0, 0, 224, 224);
  }
  return { duration: v.duration, ms: (performance.now() - t0) / n };
}, Number(n));
console.log(`${n} frames from a ${(r.duration / 60).toFixed(1)} min video: ${r.ms.toFixed(1)} ms per frame -> ${(r.ms * 30 / 1000).toFixed(2)} s per minute of video at one frame every 2 s`);
await b.close();
