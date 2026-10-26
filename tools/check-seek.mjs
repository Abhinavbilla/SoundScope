// Click-to-play on the timeline: pressing anywhere on the waveform or a sound's lane plays from that
// point, dragging scrubs, and clicking a lane's name doesn't seek. For a video, the picture follows.
// Needs `vite preview` on :4173. Usage: node tools/check-seek.mjs <audio or video file>   Env: SS_LOCAL_MODEL=1
import { chromium } from "playwright-core";

const file = process.argv[2];
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
const b = await chromium.launch({ channel: "msedge", headless: false });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
}, !!process.env.SS_LOCAL_MODEL);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
await page.goto((process.env.SS_BASE || `http://localhost:${process.env.SS_PORT || 4173}`) + "/");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 600_000 });
await page.waitForTimeout(1000);

const duration = await page.evaluate(() => window.__soundscopeResult.duration);
const state = () => page.evaluate(() => ({
  t: window.__soundscopePlayer.time(),
  playing: window.__soundscopePlayer.playing(),
  video: document.querySelector("video")?.currentTime ?? null,
}));
const pause = () => page.evaluate(() => { if (window.__soundscopePlayer.playing()) window.__soundscopePlayer.toggle(); });
const area = await page.locator(".track__area").boundingBox();
const at = (f) => area.x + area.width * f;
const tol = Math.max(0.5, duration * 0.01);

// 1. waveform
const wave = await page.locator(".track__wave").boundingBox();
await page.mouse.click(at(0.25), wave.y + wave.height / 2);
await page.waitForTimeout(600);
let s = await state();
ok(s.playing && Math.abs(s.t - 0.25 * duration) < tol + 0.8, `waveform click at 25% (${(0.25 * duration).toFixed(1)} s) -> playing from ${s.t.toFixed(2)} s`);
await pause();

// 2. a sound's lane, in an empty spot or on an interval: either way it plays from the clicked point
const lane = await page.locator(".trow__bar").last().boundingBox();
await page.mouse.click(at(0.75), lane.y + lane.height / 2);
await page.waitForTimeout(600);
s = await state();
ok(s.playing && Math.abs(s.t - 0.75 * duration) < tol + 0.8, `lane click at 75% (${(0.75 * duration).toFixed(1)} s) -> playing from ${s.t.toFixed(2)} s`);
const active = await page.evaluate(() => document.querySelector(".trow--active .trow__name")?.textContent);
const last = await page.evaluate(() => [...document.querySelectorAll(".trow__name")].at(-1)?.textContent);
ok(active === last, `the clicked lane becomes the selected sound (${active})`);
if (s.video !== null) ok(Math.abs(s.video - s.t) < 0.5, `video follows: picture at ${s.video.toFixed(2)} s`);
await pause();

// 3. drag to scrub: the playhead follows while held, playback starts where it's let go
await page.mouse.move(at(0.1), wave.y + wave.height / 2);
await page.mouse.down();
await page.mouse.move(at(0.35), wave.y + wave.height / 2, { steps: 8 });
await page.waitForTimeout(250);
const mid = await state();
await page.mouse.move(at(0.6), wave.y + wave.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(600);
s = await state();
ok(Math.abs(mid.t - 0.35 * duration) < tol + 0.3, `while dragging, playhead at ${mid.t.toFixed(2)} s (pointer at ${(0.35 * duration).toFixed(1)} s)`);
ok(s.playing && Math.abs(s.t - 0.6 * duration) < tol + 0.8, `released at 60% (${(0.6 * duration).toFixed(1)} s) -> playing from ${s.t.toFixed(2)} s`);
const head = await page.$eval(".playhead", (el) => parseFloat(el.style.left));
ok(Math.abs(head / 100 - s.t / duration) < 0.02, `playhead drawn at ${head.toFixed(1)}%`);
await pause();

// 4. clicking a lane's name selects it but doesn't seek
const before = (await state()).t;
await page.locator(".trow__label").first().click();
await page.waitForTimeout(400);
s = await state();
ok(Math.abs(s.t - before) < 0.05 && !s.playing, `name click: no seek (${before.toFixed(2)} -> ${s.t.toFixed(2)} s), not playing`);

// 5. the moments list plays just the moment: from its start, pausing at its end (at least 1 s)
const first = page.locator(".moment").first();
if (await first.count()) {
  const txt = await first.locator("span").first().textContent();
  const [start, end] = txt.split("–").map((p) => p.trim().split(":").reduce((a, v) => a * 60 + Number(v), 0));
  const stop = Math.max(end, start + 1);
  await first.click();
  await page.waitForTimeout(300);
  s = await state();
  ok(s.playing && s.t >= start - 0.1 && s.t < start + 0.6, `moment click at ${start.toFixed(1)} s -> playing from ${s.t.toFixed(2)} s`);
  await page.waitForFunction(() => !window.__soundscopePlayer.playing(), null, { timeout: (stop - start + 5) * 1000 }).catch(() => {});
  s = await state();
  ok(!s.playing && s.t >= stop - 0.1 && s.t < stop + 0.4, `moment ${start.toFixed(1)}-${end.toFixed(1)} s -> paused at ${s.t.toFixed(2)} s (expected ${stop.toFixed(1)})`);

  // moving the playhead cancels the stop
  await first.click();
  await page.waitForTimeout(200);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout((stop - start) * 1000 + 600);
  s = await state();
  ok(s.playing, `skipping during a moment cancels its stop (playing at ${s.t.toFixed(2)} s)`);
  await pause();
}
await b.close();
