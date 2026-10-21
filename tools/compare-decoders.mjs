// Compare the streaming decoder's output with the browser's whole-file decoder for the same file.
// Needs `vite preview` on :4173. Usage: node tools/compare-decoders.mjs <file> <outDir>
// Writes the first 120 s of both versions as raw float32 for a model-level comparison.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [file, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
await page.addInitScript(() => { window.__soundscopeDebug = true; window.__soundscopeCollect = true; });
await page.goto("http://localhost:4173/");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 20 * 60_000, polling: 500 });

const r = await page.evaluate(async () => {
  const stream = window.__soundscopeSamples;
  const buf = await new OfflineAudioContext(1, 1, 32000).decodeAudioData(await window.__soundscopeFile.arrayBuffer());
  const whole = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) whole[i] += d[i] / buf.numberOfChannels;
  }
  // Find the time offset: cross-correlate 20 s starting at 60 s, lags of +-0.1 s.
  const start = 60 * 32000, len = 20 * 32000, maxLag = 3200;
  let best = 0, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < len; i += 2) s += whole[start + i] * stream[start + i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  // Difference after aligning (stream[i + lag] ~ whole[i]).
  let err = 0, sig = 0, maxAbs = 0;
  const n = Math.min(whole.length, stream.length - Math.max(0, bestLag)) - Math.max(0, -bestLag);
  for (let i = Math.max(0, -bestLag); i < n; i++) {
    const d = stream[i + bestLag] - whole[i];
    err += d * d; sig += whole[i] * whole[i];
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
  }
  const b64 = (a) => {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return {
    lengths: { stream: stream.length, whole: whole.length },
    lagSamples: bestLag, lagMs: (bestLag / 32000) * 1000,
    snrDb: 10 * Math.log10(sig / err), maxAbsDiff: maxAbs,
    streamHead: b64(stream.subarray(0, 120 * 32000)),
    wholeHead: b64(whole.subarray(0, 120 * 32000)),
  };
});
const base = path.basename(file).replace(/\.\w+$/, "");
fs.writeFileSync(path.join(outDir, `${base}_stream.f32`), Buffer.from(r.streamHead, "base64"));
fs.writeFileSync(path.join(outDir, `${base}_whole.f32`), Buffer.from(r.wholeHead, "base64"));
delete r.streamHead; delete r.wholeHead;
console.log(JSON.stringify({ file: path.basename(file), ...r }));
await browser.close();
