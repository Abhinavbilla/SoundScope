// Screenshots of every UI state for review: landing, analysing, results, search, bookmarks, error.
// Needs `vite preview` on :4173. Usage: node tools/screenshot-ui.mjs <outDir> <file> [video file]
// Env: SS_WIDTH (default 1280), SS_THEME=light|dark (default dark), SS_LOCAL_MODEL=1
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [out, file, video] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const width = Number(process.env.SS_WIDTH) || 1280;
const theme = process.env.SS_THEME || "dark";
const tag = `${theme}-${width}`;
const b = await chromium.launch({ channel: "msedge", headless: false });
const ctx = await b.newContext({ viewport: { width, height: 900 }, colorScheme: theme, deviceScaleFactor: width < 600 ? 2 : 1 });
const page = await ctx.newPage();
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
}, !!process.env.SS_LOCAL_MODEL);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); });
const shot = (name, full = true) => page.screenshot({ path: path.join(out, `${tag}-${name}.png`), fullPage: full });

await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.waitForTimeout(800);
await shot("1-landing");

await page.setInputFiles("input[type=file]", file);
await page.waitForSelector(".progress", { timeout: 30_000 });
await page.waitForFunction(() => document.querySelectorAll(".trow").length > 0 || window.__soundscopeLast, null, { timeout: 120_000 });
await page.waitForTimeout(1500);
await shot("2-analysing");

await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 600_000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { const m = document.querySelectorAll(".moment"); m[Math.min(1, m.length - 1)]?.click(); });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelectorAll("audio,video").forEach((m) => m.pause()));
await page.mouse.move(width * 0.45, 330);
await shot("3-results");

await page.fill("#search", "dog");
await page.waitForTimeout(500);
await shot("4-search", false);
const group = page.locator(".search__head button");
if (await group.count()) await group.click();
await page.fill("#search", "");
await page.waitForTimeout(800);
const stars = page.locator(".star");
for (let i = 0; i < Math.min(2, await stars.count()); i++) await stars.nth(i).click();
await page.click("text=Bookmarks");
await page.waitForTimeout(500);
await page.locator(".bookmark__note").first().fill("Neighbour's dog").catch(() => {});
await shot("5-bookmarks");

if (video) {
  await page.setInputFiles("input[type=file]", video);
  await page.waitForFunction(() => window.__soundscopeLast?.hasVideo && window.__soundscopePlayer, null, { timeout: 600_000 });
  await page.waitForTimeout(1500);
  await shot("6-video");
}
await page.setInputFiles("input[type=file]", "test-audio/video/v2min.avi");
await page.waitForSelector(".toast--error", { timeout: 30_000 });
await shot("7-error", false);
await b.close();
console.log("done", tag);
