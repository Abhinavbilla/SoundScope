// Breaks things on purpose and checks that every message on screen is written for people: no error
// names, codes, file paths or stack traces, and each one says what to do next.
// Cases: empty, damaged and mislabelled files, a video with no sound, the model failing to download or
// arriving corrupted, the Dolby decoder failing to load, clips that can't be saved or made, a bookmark
// that can't be saved, a video clip that can't be made, and the interface itself crashing.
// Usage: node tools/check-error-messages.mjs <audio file> [video without sound]
// Env: SS_BASE (default http://localhost:4173), SS_BROWSER=msedge|chrome (chrome for the Dolby cases),
//      SS_DOLBY_FILE (a Dolby file), SS_DOLBY_VIDEO (a video with Dolby sound)
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [audio, silentVideo] = process.argv.slice(2);
const base = process.env.SS_BASE || "http://localhost:4173";
const browserName = process.env.SS_BROWSER || "msedge";
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-errors-"));

// Things people shouldn't see: error class names, codes, URLs, file names of code, stack lines, raw values.
const TECHNICAL = /\b\w*(Error|Exception)\b|\bundefined\b|\bnull\b|\bNaN\b|\bat \S+ \(|0x[0-9a-f]+|https?:|\.m?js\b|\(\d{3}\)|\bstatus \d|\bcode\b|checksum|sha|wasm|worker|onnx|codec|decod/i;
// ...and a next step should always be offered.
const NEXT_STEP = /try|choose|convert|reload|free up|close|open/i;

function check(name, text, { nextStep = true } = {}) {
  if (!text) { ok(false, `${name}: no message shown`); return; }
  const t = text.replace(/\s+/g, " ").trim();
  const bad = t.match(TECHNICAL)?.[0];
  ok(!bad && (!nextStep || NEXT_STEP.test(t)), `${name}: "${t}"${bad ? `  <- technical: "${bad}"` : ""}${nextStep && !NEXT_STEP.test(t) ? "  <- no next step" : ""}`);
}

async function fresh(init = () => {}, arg) {
  const ctx = await chromium.launchPersistentContext(path.join(tmp, "p" + Math.random().toString(36).slice(2)),
    { channel: browserName, headless: false, acceptDownloads: true });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.addInitScript(() => { window.__soundscopeDebug = true; });
  await page.addInitScript(init, arg);
  return { ctx, page };
}

async function openError(page, file) {
  await page.goto(base + "/");
  await page.setInputFiles("input[type=file]", file);
  await page.waitForSelector(".toast--error", { timeout: 120_000 });
  return page.locator(".toast--error").innerText();
}

async function analysed(page, file) {
  await page.goto(base + "/");
  await page.setInputFiles("input[type=file]", file);
  await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 300_000 });
}

// 1. files
const empty = path.join(tmp, "empty.mp3"); fs.writeFileSync(empty, "");
const junk = path.join(tmp, "damaged.mp3"); fs.writeFileSync(junk, Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7919) % 251)));
const text = path.join(tmp, "notes.mp4"); fs.writeFileSync(text, "this is a text file, not a video\n".repeat(500));
const exe = path.join(tmp, "program.wav"); fs.writeFileSync(exe, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(50_000, 0x90)]));
{
  const { ctx, page } = await fresh();
  for (const [name, f] of [["empty file", empty], ["damaged MP3", junk], ["text file named .mp4", text], ["program named .wav", exe]]) {
    check(name, await openError(page, f));
  }
  if (silentVideo) check("video with no sound", await openError(page, silentVideo));
  await ctx.close();
}

// 2. model can't be downloaded / arrives corrupted
{
  const { ctx, page } = await fresh(() => { window.__soundscopeModelUrl = "/models/missing.onnx.gz"; });
  check("model download fails", await openError(page, audio));
  await ctx.close();
}
{
  const { ctx, page } = await fresh(() => { window.__soundscopeModelSha256 = "0".repeat(64); window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx.gz"; });
  check("model arrives corrupted", await openError(page, audio));
  await ctx.close();
}
{
  const { ctx, page } = await fresh();
  await page.route(/\.onnx/, (r) => r.abort("internetdisconnected"));
  check("offline on first visit", await openError(page, audio));
  await ctx.close();
}

// 3. the Dolby decoder can't be downloaded (only where the browser can't decode Dolby itself)
const dolby = process.env.SS_DOLBY_FILE;
if (dolby) {
  const { ctx, page } = await fresh();
  await page.route(/mediabunny-ac3/, (r) => r.abort("internetdisconnected"));
  check("Dolby decoder can't be downloaded", await openError(page, dolby));
  await ctx.close();
}
// ...and for a video: analysed fine, but the part that plays its sound can't be downloaded
const dolbyVideo = process.env.SS_DOLBY_VIDEO;
if (dolbyVideo) {
  const { ctx, page } = await fresh();
  await page.route(/dolbyPlayback/, (r) => r.abort("internetdisconnected"));
  await analysed(page, dolbyVideo);
  await page.waitForSelector(".play-note", { timeout: 30_000 });
  check("Dolby video sound can't be played", await page.locator(".play-note").innerText());
  // a video clip that can't be made
  await page.route(/videoClip\.worker/, (r) => r.abort("failed"));
  await page.locator(".star").first().click();
  await page.click('.tab:has-text("Bookmarks")');
  await page.locator('.bookmark button[title^="Download this moment as a video"]').first().click();
  await page.waitForSelector(".toast--error", { timeout: 60_000 });
  check("video clip can't be made", await page.locator(".toast--error").innerText());
  await ctx.close();
}

// 4. clips: the folder can't be written to (disk full), and the clip maker fails to start
{
  const { ctx, page } = await fresh(() => {
    window.showDirectoryPicker = async () => ({
      getFileHandle: async () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); },
    });
  });
  await analysed(page, audio);
  await page.locator(".star").nth(0).click();
  await page.locator(".star").nth(1).click();
  await page.click('.tab:has-text("Bookmarks")');
  await page.click("text=Download all clips");
  await page.waitForFunction(() => /space|couldn/i.test(document.querySelector(".toasts")?.textContent ?? ""), null, { timeout: 60_000 });
  check("clips: disk full", await page.locator(".toasts").innerText());

  await page.route(/clip\.worker/, (r) => r.abort("failed"));
  await page.locator(".bookmark button", { hasText: "Clip" }).first().click();
  await page.waitForFunction(() => /went wrong/i.test(document.querySelector(".toasts")?.textContent ?? ""), null, { timeout: 60_000 });
  check("clips: clip maker fails to start", await page.locator(".toasts").innerText());

  // 5. a bookmark can't be saved (close the clip message first, so only the new one is on screen)
  await page.click(".toast__close");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
  });
  await page.click("text=Bookmark this point");
  await page.waitForSelector(".toast--error", { timeout: 10_000 });
  check("bookmark can't be saved", await page.locator(".toast--error").innerText());
  await page.click(".toast--error .toast__close");
  ok(await page.locator(".toast--error").count() === 0, "the bookmark message can be dismissed");
  await ctx.close();
}

// 6. the interface crashes
{
  const { ctx, page } = await fresh(() => { window.__soundscopeCrash = true; });
  await page.goto(base + "/");
  await page.setInputFiles("input[type=file]", audio);
  await page.waitForSelector(".crash", { timeout: 300_000 });
  check("interface crash", await page.locator(".crash").innerText());
  await page.click("text=Reload page");
  await page.evaluate(() => { window.__soundscopeCrash = false; });
  await page.waitForSelector("text=Find any sound", { timeout: 30_000 });
  ok(true, "reload brings the app back");
  await ctx.close();
}
