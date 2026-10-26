// Step 6 checks in a real browser: bookmark moments, notes, reload, a bookmark at the playback
// position, CSV export, single clip, all clips (downloads, and into a picked folder).
// Needs `vite preview` on :4173.
// Usage: node tools/check-bookmarks.mjs <outDir> <file> [<at seconds> ...]
//   Saves downloads to outDir; with "at" times, also bookmarks those playback positions (for clip checks).
// Env: SS_BROWSER=msedge|chrome, SS_FOLDER=1 (stand in for the folder picker with an OPFS folder), SS_FALLBACK=1,
//      SS_LOCAL_MODEL=1 (model from /models/ instead of Hugging Face), SS_WIDTH, SS_SHOT=<png>
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [outDir, file, ...ats] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const ok = (cond, msg) => console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
const dir = path.join(os.tmpdir(), "ssprobe-bm-" + Date.now());
const ctx = await chromium.launchPersistentContext(dir, {
  channel: process.env.SS_BROWSER || "msedge", headless: false, acceptDownloads: true,
  viewport: { width: Number(process.env.SS_WIDTH) || 1100, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript(([folder, fallback, local]) => {
  window.__soundscopeDebug = true;
  if (fallback) window.__soundscopeForceFallback = true; // SS_FALLBACK=1: whole-file decode for analysis and clips
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; // SS_LOCAL_MODEL=1
  if (folder) {
    // test only: the folder picker can't be clicked by a script, so hand back an OPFS folder instead
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("picked", { create: true });
  } else {
    delete window.showDirectoryPicker; // one download per clip
    window.showDirectoryPicker = undefined;
  }
}, [!!process.env.SS_FOLDER, !!process.env.SS_FALLBACK, !!process.env.SS_LOCAL_MODEL]);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

async function openFile() {
  await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
  await page.setInputFiles("input[type=file]", file);
  await page.waitForFunction(() => window.__soundscopeLast?.ok === false || (window.__soundscopeLast && window.__soundscopePlayer),
    null, { timeout: 600_000 });
  const last = await page.evaluate(() => window.__soundscopeLast);
  if (!last.ok) {
    console.log(`FAIL  the app couldn't analyse the file: ${last.message} (${last.detail})`);
    process.exit(1);
  }
  await page.waitForTimeout(400);
}
const tab = (name) => page.click(`.tab:has-text("${name}")`);
const bookmarks = async () => (await tab("Bookmarks"), page.$$eval(".bookmark", (els) => els.map((li) => ({
  time: li.querySelector(".bookmark__time span").textContent, label: li.querySelector(".bookmark__time .muted").textContent,
  note: li.querySelector(".bookmark__note").value,
}))));
async function grab(trigger, n = 1) {
  const got = [];
  const done = new Promise((resolve) => {
    page.on("download", async function onDl(d) {
      const to = path.join(outDir, d.suggestedFilename());
      await d.saveAs(to);
      got.push(to);
      if (got.length === n) { page.off("download", onDl); resolve(); }
    });
  });
  await trigger();
  await Promise.race([done, page.waitForTimeout(60_000)]);
  return got;
}

await openFile();
const name = path.basename(file);

// 1. star the first two moments of the active row; toggle one off and on again
await tab("Moments");
const stars = page.locator(".star");
const nStars = await stars.count();
if (nStars >= 2) {
  await tab("Moments");
  await stars.nth(0).click();
  await stars.nth(1).click();
  await page.waitForTimeout(200);
  let b = await bookmarks();
  ok(b.length === 2, `star two moments -> ${b.length} bookmarks ${JSON.stringify(b.map((x) => `${x.time} ${x.label}`))}`);
  await tab("Moments");
  await stars.nth(1).click();
  await page.waitForTimeout(200);
  const off = (await bookmarks()).length;
  await tab("Moments");
  await stars.nth(1).click();
  await page.waitForTimeout(200);
  ok(off === 1 && (await bookmarks()).length === 2, `star toggles off and on (${off} -> ${(await bookmarks()).length})`);
  // 2. a note with a comma and quotes, kept after a reload
  await tab("Bookmarks");
  await page.locator(".bookmark__note").first().fill('first one, "loud"');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
}

// 3. bookmarks at given playback positions
for (const at of ats) {
  await page.evaluate((t) => { window.__soundscopePlayer.playFrom(Number(t)); document.querySelectorAll("audio,video").forEach((m) => m.pause()); }, at);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll("audio,video").forEach((m) => m.pause()));
  await tab("Bookmarks");
  await page.click("text=Bookmark this point");
  await page.waitForTimeout(200);
}
if (ats.length) {
  const b = await bookmarks();
  ok(b.length >= ats.length, `bookmarks at playback positions ${ats.join(", ")} s -> ${JSON.stringify(b.filter((x) => x.label === "Your bookmark").map((x) => x.time))}`);
}

if (process.env.SS_SHOT) await page.screenshot({ path: process.env.SS_SHOT, fullPage: true });

// reload: bookmarks and note come back
await openFile();
const after = await bookmarks();
ok(after.length === (nStars >= 2 ? 2 : 0) + ats.length && (nStars < 2 || after.some((x) => x.note === 'first one, "loud"')),
  `after reopening: ${after.length} bookmarks, note kept: ${after.some((x) => x.note === 'first one, "loud"')}`);

// 4. CSV
const [csvPath] = await grab(() => page.click("text=Download list"));
const csv = fs.readFileSync(csvPath, "utf8");
ok(csv.startsWith("﻿Start,End,Sound,Note,Start (seconds),End (seconds),Score (0 to 1)\r\n") && csv.trim().split("\r\n").length === after.length + 1,
  `CSV ${path.basename(csvPath)}: ${csv.trim().split("\r\n").length - 1} rows; ${JSON.stringify(csv.replace("﻿", "").split("\r\n").slice(0, 3))}`);

// 5. one clip
const [clip1] = await grab(() => page.locator(".bookmark button", { hasText: "Clip" }).first().click());
ok(!!clip1 && fs.statSync(clip1).size > 44, `single clip: ${clip1 && path.basename(clip1)} (${clip1 && fs.statSync(clip1).size} bytes)`);

// 6. all clips
const t0 = Date.now();
if (process.env.SS_FOLDER) {
  await page.click("text=Download all clips");
  await page.waitForFunction(() => /\d+ clips saved|couldn/.test(document.querySelector(".toasts")?.textContent ?? ""), null, { timeout: 120_000 });
  const files = await page.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked");
    const out = [];
    for await (const [n, h] of d.entries()) out.push([n, (await h.getFile()).size]);
    return out;
  });
  ok(files.length === after.length, `all clips into the picked folder: ${JSON.stringify(files)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} else {
  const all = await grab(() => page.click("text=Download all clips"), after.length);
  await page.waitForFunction(() => /\d+ clips saved|couldn/.test(document.querySelector(".toasts")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => {});
  ok(all.length === after.length, `all clips as downloads: ${all.length} of ${after.length} (${all.map((f) => path.basename(f)).join(", ")}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const status = await page.textContent(".toasts").catch(() => "");
console.log(`      status: ${status}`);
console.log(`      file: ${name}`);
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
