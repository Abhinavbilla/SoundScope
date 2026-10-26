// Step 4 checks in a real browser: live results during analysis, sound list, sensitivity slider,
// timeline rows, playing a moment from its start (list click) or from the clicked point (timeline click), adding/removing rows,
// reopening saved results. Screenshots go to the scratch dir given as SS_SHOTS (optional).
// Needs `vite preview` on :4173. Usage: node tools/check-timeline.mjs <file>   Env: SS_BROWSER, SS_WIDTH, SS_DARK=1
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = process.argv[2];
const shots = process.env.SS_SHOTS;
const dir = path.join(os.tmpdir(), "ssprobe-tl-" + Date.now());
const ctx = await chromium.launchPersistentContext(dir, {
  channel: process.env.SS_BROWSER || "msedge", headless: false,
  viewport: { width: Number(process.env.SS_WIDTH) || 1100, height: 900 },
  colorScheme: process.env.SS_DARK ? "dark" : "light",
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; // SS_LOCAL_MODEL=1
}, !!process.env.SS_LOCAL_MODEL);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
const ok = (cond, msg) => console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
const name = path.basename(file);
const snap = async (label) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}-${label}.png`), fullPage: true }); };

await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
const t0 = Date.now();
await page.setInputFiles("input[type=file]", file);

// 1. live results while analysing
let liveSeen = null;
while (!(await page.evaluate(() => window.__soundscopeLast))) {
  const live = await page.$eval(".workspace", (el) => ({
    note: !!el.textContent.match(/Found so far/), rows: el.querySelectorAll(".trow").length,
    sounds: el.querySelectorAll(".sounds__list li").length,
    progress: document.querySelector(".progress .small")?.textContent,
  })).catch(() => null);
  if (live && live.rows && !liveSeen) { liveSeen = { ...live, atSeconds: (Date.now() - t0) / 1000 }; await snap("live"); }
  await page.waitForTimeout(250);
}
const last = await page.evaluate(() => window.__soundscopeLast);
const short = last.duration < 120; // finishes before the first live update
ok(liveSeen || short, `live results during analysis: ${JSON.stringify(liveSeen)}${short ? " (short file)" : ""}`);

// 2. after the analysis
await page.waitForFunction(() => window.__soundscopePlayer, null, { timeout: 30000 });
await page.waitForTimeout(800); // full-detail timelines load from storage
const state = () => page.$eval(".workspace", (el) => ({
  live: !!el.textContent.match(/Found so far/),
  rows: [...el.querySelectorAll(".trow__label")].map((b) => b.textContent),
  sounds: Number(el.querySelector(".sounds .h2 .muted").textContent.replace(/\D/g, "")),
  moments: el.querySelectorAll(".moment").length,
  threshold: `score ≥ ${Number(document.querySelector("#sensitivity").dataset.threshold).toPrecision(2)}`,
}));
let s = await state();
ok(!s.live && s.rows.length === Math.min(3, s.sounds), `after analysis: ${s.sounds} sounds, rows ${JSON.stringify(s.rows)}, ${s.moments} moments listed, ${s.threshold}`);
await snap("done");

// 3. slider: more sensitive -> at least as many sounds; less -> at most as many
const slider = page.locator("#sensitivity");
const setPos = async (v) => slider.evaluate((el, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, String(v));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, v);
const base = s.sounds;
await setPos(0.9); await page.waitForTimeout(300);
const more = await state();
await setPos(0.1); await page.waitForTimeout(300);
const fewer = await state();
ok(more.sounds >= base && fewer.sounds <= base, `slider: more ${more.sounds} (${more.threshold}), start ${base}, fewer ${fewer.sounds} (${fewer.threshold})`);
const tSlide = await page.evaluate(async () => {
  const el = document.querySelector("#sensitivity");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const t = performance.now();
  set.call(el, "0.6"); el.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  return performance.now() - t;
});
console.log(`      slider move to repaint: ${tSlide.toFixed(0)} ms`);
await setPos(1 - Math.log(0.05 / 0.001) / Math.log(500)); await page.waitForTimeout(300); // back to 0.05
s = await state();

// 4. play a moment from the list: starts at its start. Use the row with the most moments and a
// moment at least 5 s in, so the 2 s lead-in is visible.
await page.evaluate(() => {
  const labels = [...document.querySelectorAll(".trow__label")];
  const count = (b) => Number(b.textContent.split("·").pop());
  labels.sort((a, b) => count(b) - count(a))[0]?.click();
});
await page.waitForTimeout(200);
const toSec = (txt) => txt.trim().split(":").reduce((a, x) => a * 60 + Number(x), 0);
const pick = await page.$$eval(".moment > span:first-child", (els) => els.map((e) => e.textContent));
const idx = pick.findIndex((t) => t.split("–")[0].trim().split(":").reduce((a, x) => a * 60 + Number(x), 0) >= 5);
s = await state();
if (idx >= 0) {
  const start = toSec(pick[idx].split("–")[0]);
  await page.locator(".moment").nth(idx).click();
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => ({ t: window.__soundscopePlayer.time(), playing: window.__soundscopePlayer.playing() }));
  ok(p.playing && p.t >= start - 0.1 && p.t < start + 1, `list click: moment at ${start.toFixed(1)} s -> playing from ${p.t.toFixed(2)} s`);
  await page.evaluate(() => document.querySelector("video, audio")?.pause?.());
  await page.keyboard.press("Escape");
}

// 5. click an interval on the timeline bar: plays from the clicked point
const target = await page.evaluate(() => {
  const r = window.__soundscopeResult;
  const bar = document.querySelector(".trow--active .trow__bar") || document.querySelector(".trow__bar");
  const spans = [...document.querySelectorAll(".moments__list .moment > span:first-child")];
  const toS = (t) => t.trim().split(":").reduce((a, v) => a * 60 + Number(v), 0);
  const btn = spans.find((e) => toS(e.textContent.split("–")[0]) >= 5) || spans[0];
  if (!btn || !bar) return null;
  const parts = btn.textContent.split("–").map((x) => x.trim().split(":").reduce((a, v) => a * 60 + Number(v), 0));
  const rect = bar.getBoundingClientRect();
  const mid = (parts[0] + parts[1]) / 2;
  return { x: rect.left + (mid / r.duration) * rect.width, y: rect.top + rect.height / 2, start: parts[0], mid };
});
if (target) {
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => ({ t: window.__soundscopePlayer.time(), playing: window.__soundscopePlayer.playing() }));
  ok(p.playing && Math.abs(p.t - target.mid) < 1.2, `timeline click: middle of an interval at ${target.mid.toFixed(1)} s -> playing from ${p.t.toFixed(2)} s`);
  const cursor = await page.$eval(".playhead", (el) => el.style.left);
  ok(!!cursor && cursor !== "0%", `playback cursor on the timeline at ${cursor}`);
  await page.evaluate(() => { const m = document.querySelector("video") || null; if (m) m.pause(); });
  await page.click(".trow__label"); // harmless click, also pauses nothing
}
const video = await page.$("video");
if (video) {
  const vt = await video.evaluate((v) => v.currentTime);
  ok(vt > 0, `video element followed: currentTime ${vt.toFixed(2)} s`);
}
await page.evaluate(() => window.__soundscopePlayer && document.querySelectorAll("audio,video").forEach((m) => m.pause()));

// 6. add a sound from the list, then remove it with ×
const before = (await state()).rows.length;
const unchecked = page.locator(".sounds__list input:not(:checked)").first();
if (await unchecked.count()) {
  await unchecked.check();
  const added = (await state()).rows.length;
  await page.locator(".trow__remove").last().click();
  const removed = (await state()).rows.length;
  ok(added === before + 1 && removed === before, `add/remove row: ${before} -> ${added} -> ${removed}`);
}

// 7. reopen: saved results show straight away with the timeline
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
const t1 = Date.now();
await page.setInputFiles("input[type=file]", file);
await page.waitForSelector(".trow", { timeout: 30000 });
const again = await page.evaluate(() => window.__soundscopeLast);
ok(again.path === "saved", `reopen: path ${again.path}, timeline shown after ${((Date.now() - t1) / 1000).toFixed(2)} s`);

console.log(`      analysis took ${(last.timings.totalMs / 1000).toFixed(1)} s for ${(last.duration / 60).toFixed(1)} min`);
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
