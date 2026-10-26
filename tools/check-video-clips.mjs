// Video clips: for a video, a bookmark's "Video" button downloads an MP4 with picture and sound, covering
// the bookmark with 1 s of padding; it plays in the browser and its sound isn't silent (Dolby sound is
// converted so it plays). An audio file has no "Video" button.
// Usage: node tools/check-video-clips.mjs <outDir> <video> [<video> ...] [--audio <audio file>]
// Env: SS_BASE (default http://localhost:4173), SS_BROWSER=msedge|chrome
import { chromium } from "playwright-core";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const audioAt = args.indexOf("--audio");
const audioFile = audioAt >= 0 ? args.splice(audioAt, 2)[1] : null;
const [outDir, ...videos] = args;
const base = process.env.SS_BASE || "http://localhost:4173";
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
fs.mkdirSync(outDir, { recursive: true });

const dir = path.join(os.tmpdir(), "ssprobe-vclip-" + Date.now());
process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use */ } }); // no leftover browser profiles
const ctx = await chromium.launchPersistentContext(dir,
  { channel: process.env.SS_BROWSER || "chrome", headless: false, acceptDownloads: true });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript(() => { window.__soundscopeDebug = true; });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const seconds = (t) => t.trim().split(":").reduce((a, v) => a * 60 + Number(v), 0);

async function open(f) {
  await page.goto(base + "/");
  await page.setInputFiles("input[type=file]", f);
  await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 600_000 });
  await page.locator(".star").first().click();
  await page.click('.tab:has-text("Bookmarks")');
}

for (const video of videos) {
  const name = path.basename(video);
  await open(video);
  const [start, end] = (await page.locator(".bookmark__time span").first().textContent()).split("–").map(seconds);
  const duration = await page.evaluate(() => window.__soundscopeResult.duration);
  const want = Math.min(duration, end + 1) - Math.max(0, start - 1);
  const t0 = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.locator('.bookmark button[title^="Download this moment as a video"]').first().click(),
  ]);
  const to = path.join(outDir, download.suggestedFilename());
  await download.saveAs(to);
  const took = (Date.now() - t0) / 1000;
  const toast = await page.locator(".toast").first().textContent().catch(() => "");

  // what's inside
  const bytes = fs.readFileSync(to);
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
  const got = await input.computeDuration();
  const info = `${(bytes.length / 1e6).toFixed(1)} MB, ${got.toFixed(2)} s (bookmark ${start.toFixed(1)}–${end.toFixed(1)} s + padding = ${want.toFixed(2)} s), picture ${v ? await v.getCodec() : "none"}, sound ${a ? await a.getCodec() : "none"}, made in ${took.toFixed(1)} s`;
  ok(/\.mp4$/.test(to) && v && a && Math.abs(got - want) < 0.25 && /saved/i.test(toast), `${name}: ${path.basename(to)}: ${info}`);

  // plays in the browser, with sound that isn't silent
  const play = await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
    const el = document.createElement("video");
    el.muted = true;
    el.src = url;
    await new Promise((r, j) => { el.onloadeddata = r; el.onerror = () => j(new Error("can't load")); });
    await el.play();
    // a copied clip starts at the key frame before the cut, so starting can take a moment
    for (let i = 0; i < 30 && el.currentTime < 0.5; i++) await new Promise((r) => setTimeout(r, 100));
    const res = { width: el.videoWidth, time: el.currentTime, duration: el.duration, error: el.error?.code ?? null };
    el.pause();
    try {
      const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(data.buffer.slice(0));
      res.rms = 0; // loudest channel (e.g. a 5.1 clip may have sound only in the centre)
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
        res.rms = Math.max(res.rms, Math.sqrt(s / d.length));
      }
    } catch { res.rms = null; }
    return res;
  }, bytes.toString("base64"));
  ok(!play.error && play.width > 0 && play.time >= 0.5 && play.rms > 0.001,
    `${name}: plays in the browser (${play.width} px wide, playing (at ${play.time.toFixed(1)} s), sound level ${play.rms?.toFixed(3) ?? "not decodable"})`);
}

if (audioFile) {
  await open(audioFile);
  const buttons = await page.locator('.bookmark button[title^="Download this moment as a video"]').count();
  ok(buttons === 0, `${path.basename(audioFile)}: no Video button for an audio file (${buttons})`);
}
await ctx.close();
