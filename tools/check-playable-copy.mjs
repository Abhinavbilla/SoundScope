// Files the browser's own player can't play (MPEG-TS in Chrome, MKV in Safari): SoundScope prepares an MP4
// copy on the device and plays that. Checks: the "preparing" note shows and goes away, the picture and the
// sound then play (from the copy), seeking works, there's no "can't play" note, and Dolby sound isn't
// played twice (the copy's sound is converted, so SoundScope's own Dolby player stays off).
// Usage: node tools/check-playable-copy.mjs <file> [--pretend]
//   --pretend: act as if the player couldn't play the file (to check MKV the way Safari sees it)
// Env: SS_BASE (default http://localhost:4173), SS_BROWSER=msedge|chrome
import fs from "node:fs";
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const pretend = args.includes("--pretend");
const [file] = args.filter((a) => a !== "--pretend");
const base = process.env.SS_BASE || "http://localhost:4173";
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

const dir = path.join(os.tmpdir(), "ssprobe-copy-" + Date.now());
process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use */ } }); // no leftover browser profiles
const ctx = await chromium.launchPersistentContext(dir,
  { channel: process.env.SS_BROWSER || "chrome", headless: false });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript((pretend) => { window.__soundscopeDebug = true; if (pretend) window.__soundscopeCantPlay = true; }, pretend);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

await page.goto(base + "/");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 600_000 });
const sawPreparing = await page.waitForFunction(() => /preparing a copy/.test(document.querySelector(".play-note")?.textContent ?? ""), null, { timeout: 30_000 })
  .then(() => true, () => false);
const t0 = Date.now();
await page.waitForFunction(() => !/preparing a copy/.test(document.querySelector(".play-note")?.textContent ?? ""), null, { timeout: 600_000 });
const took = (Date.now() - t0) / 1000;
await page.waitForTimeout(800); // the player reloads with the copy
const note = await page.locator(".play-note").textContent().catch(() => null);
ok(sawPreparing && !note, `${path.basename(file)}: "preparing" note shown, copy ready in ${took.toFixed(1)} s, no "can't play" note${note ? ` (shown: "${note.trim()}")` : ""}`);

const play = async (from) => page.evaluate(async (from) => {
  const media = document.querySelector("video") ?? null;
  window.__soundscopePlayer.playFrom(from);
  await new Promise((r) => setTimeout(r, 1500));
  const p = window.__soundscopePlayer;
  const res = { time: p.time(), playing: p.playing(), error: media?.error?.code ?? null, width: media?.videoWidth ?? null,
    audioBytes: media?.webkitAudioDecodedByteCount ?? null, ownDolby: window.__soundscopeDolby?.drift?.() ?? null };
  return res;
}, from);
const a = await play(1);
const hasVideo = a.width !== null;
ok(a.playing && a.time > 1.3 && !a.error && (!hasVideo || a.width > 0) && (a.audioBytes === null || a.audioBytes > 0),
  `plays from the copy: at ${a.time.toFixed(1)} s after 1.5 s from 1 s${hasVideo ? `, picture ${a.width} px wide` : ""}${a.audioBytes !== null ? `, sound decoded by the player: ${a.audioBytes} bytes` : ""}`);
const duration = await page.evaluate(() => window.__soundscopeResult.duration);
const b = await play(duration * 0.6);
ok(b.playing && Math.abs(b.time - duration * 0.6 - 1.5) < 0.6, `seeking in the copy: from ${(duration * 0.6).toFixed(1)} s -> at ${b.time.toFixed(1)} s`);
ok(a.ownDolby === null && b.ownDolby === null, "SoundScope's own Dolby player is off (no double sound)");
await page.evaluate(() => window.__soundscopePlayer.toggle());
await ctx.close();
