// Check files with Dolby Digital sound (AC-3 / E-AC-3, e.g. made by tools/make-dolby-sample.mjs): they
// analyse through the AC-3 extension, which is only downloaded when such a file is opened; a video plays
// with its sound even where the browser's player can't play Dolby (SoundScope plays it, in time with the
// picture, also after seeking and at 1.5x); an audio-only file shows the "can't play" note instead; a
// bookmarked moment downloads as a clip with real sound in it. With a reference file (the same recording in a normal format), the sounds found
// are compared.
// Usage: node tools/check-dolby.mjs <outDir> <dolby file> [reference file]
// Env: SS_BASE (default http://localhost:4173), SS_BROWSER=msedge|chrome
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [outDir, file, reference] = process.argv.slice(2);
const base = process.env.SS_BASE || "http://localhost:4173";
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
fs.mkdirSync(outDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), "ssprobe-dolby-" + Date.now()),
  { channel: process.env.SS_BROWSER || "msedge", headless: false, acceptDownloads: true });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript(() => {
  window.__soundscopeDebug = true;
  delete window.showDirectoryPicker; // clips arrive as downloads
  window.showDirectoryPicker = undefined;
});
const requests = [];
ctx.on("request", (r) => requests.push(r.url()));
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

/** Opens a file and returns the debug summary plus the sounds listed, loudest first. */
async function analyse(f) {
  await page.goto(base + "/");
  await page.setInputFiles("input[type=file]", f);
  await page.waitForFunction(() => window.__soundscopeLast?.ok === false || (window.__soundscopeLast && window.__soundscopePlayer),
    null, { timeout: 600_000 });
  const last = await page.evaluate(() => window.__soundscopeLast);
  const sounds = last.ok ? await page.$$eval(".sounds__name", (els) => els.slice(0, 8).map((e) => e.textContent.trim())) : [];
  return { ...last, sounds };
}

const loadedDecoder = () => requests.some((u) => /mediabunny-ac3/.test(u));

if (reference) {
  const ref = await analyse(reference);
  ok(ref.ok && !loadedDecoder(), `reference ${path.basename(reference)}: analysed, Dolby decoder not downloaded`);
  var refSounds = ref.sounds;
}

const t0 = Date.now();
const r = await analyse(file);
ok(r.ok && r.rows > 0, `${path.basename(file)}: ${r.ok ? `${r.duration.toFixed(1)} s analysed in ${((Date.now() - t0) / 1000).toFixed(1)} s, video: ${r.hasVideo}` : `${r.message} (${r.detail})`}`);
if (!r.ok) { await ctx.close(); process.exit(1); }
// Edge on Windows decodes Dolby itself (Windows' own decoders); Chrome, Firefox and Chrome on a Mac don't.
const native = await page.evaluate(async () => (await AudioDecoder.isConfigSupported({ codec: "ac-3", sampleRate: 48000, numberOfChannels: 2 }).catch(() => ({}))).supported === true);
ok(loadedDecoder() !== native, native ? "browser decodes Dolby itself: extension not downloaded" : "Dolby extension downloaded for this file");
console.log(`      sounds: ${r.sounds.join(", ")}`);
if (refSounds) {
  const shared = r.sounds.filter((s) => refSounds.includes(s));
  ok(shared.length >= Math.min(5, refSounds.length) - 1, `same sounds as the reference: ${shared.length} of the top ${r.sounds.length} (${refSounds.join(", ")})`);
}

const plays = await page.evaluate(() => ["ac-3", "ec-3"].some((c) => MediaSource.isTypeSupported(`audio/mp4; codecs="${c}"`)));
const ownSound = r.hasVideo && !plays; // SoundScope plays the sound itself
if (ownSound) await page.waitForFunction(() => window.__soundscopeDolby, null, { timeout: 30_000 }).catch(() => {});
const note = await page.locator(".play-note").textContent().catch(() => null);
ok(plays || ownSound ? !note : /can't play/.test(note ?? ""),
  plays ? "browser plays Dolby sound: no note" : ownSound ? `video: SoundScope plays the sound, no note${note ? ` (shown: "${note.trim()}")` : ""}` : `note shown: "${note?.trim()}"`);

if (r.hasVideo) {
  // play, then seek, then 1.5x: sound keeps time with the picture each time
  const run = (from, rate) => page.evaluate(async ([from, rate]) => {
    const v = document.querySelector("video");
    v.playbackRate = rate;
    window.__soundscopePlayer.playFrom(from);
    const drifts = [];
    for (let i = 0; i < 8; i++) {
      await new Promise((res) => setTimeout(res, 400));
      const d = window.__soundscopeDolby?.drift();
      if (d != null && i > 1) drifts.push(d); // after the start-up
    }
    const out = { error: v.error?.code ?? null, time: v.currentTime, drifts, stats: { ...window.__soundscopeDolby?.stats } };
    v.pause();
    return out;
  }, [from, rate]);
  for (const [from, rate] of [[1, 1], [Math.min(20, r.duration / 2), 1], [3, 1.5]]) {
    const p = await run(from, rate);
    const worst = p.drifts.length ? Math.max(...p.drifts.map(Math.abs)) : null;
    if (ownSound) {
      ok(!p.error && p.stats.scheduled > 0 && p.stats.loudest > 0.01 && worst !== null && worst < 0.1,
        `from ${from.toFixed(1)} s at ${rate}x: picture at ${p.time.toFixed(1)} s, sound scheduled (${p.stats.scheduled} pieces, peak ${(p.stats.loudest ?? 0).toFixed(2)}), worst gap to picture ${worst === null ? "none measured" : `${(worst * 1000).toFixed(0)} ms`}`);
    } else {
      console.log(`      picture: ${p.error ? `player error ${p.error}` : `plays (at ${p.time.toFixed(1)} s from ${from} s)`}`);
    }
  }
}

// a moment as a clip: real sound, not silence
await page.locator(".star").first().click();
await page.click('.tab:has-text("Bookmarks")');
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 60_000 }),
  page.locator(".bookmark button", { hasText: "Clip" }).first().click(),
]);
const to = path.join(outDir, download.suggestedFilename());
await download.saveAs(to);
const wav = fs.readFileSync(to);
const data = wav.indexOf("data") + 8;
const pcm = new Int16Array(wav.buffer, wav.byteOffset + data, (wav.length - data) >> 1);
const rms = Math.sqrt(pcm.reduce((s, v) => s + v * v, 0) / pcm.length) / 32768;
ok(pcm.length > 0 && rms > 0.001, `clip ${path.basename(to)}: ${(wav.length / 1024).toFixed(0)} KB, loudness ${rms.toFixed(3)}`);

// reopening uses the saved results, which remember the sound format
const again = await analyse(file);
const noteAgain = await page.locator(".play-note").count();
ok(again.path === "saved" && noteAgain === (note ? 1 : 0), `reopened from saved results (${again.path}): note ${noteAgain ? "shown" : "not shown"} again`);
await ctx.close();
