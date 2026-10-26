// Step 4 checks in stock Firefox (Puppeteer + BiDi): cancel while live results show, then a full run,
// timeline rows, and playing a moment from its start.
// Needs `vite preview` on :4173. Usage: node tools/check-timeline-firefox.mjs <longFile> <file> [screenshot.png]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [longFile, file, shot] = process.argv.slice(2);
const dir = path.join(os.tmpdir(), "ssprobe-fftl-" + Date.now());
fs.mkdirSync(dir);
const browser = await puppeteer.launch({
  browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: false, userDataDir: dir,
});
const page = (await browser.pages())[0];
await page.evaluateOnNewDocument((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; // SS_LOCAL_MODEL=1
}, !!process.env.SS_LOCAL_MODEL);
await page.setViewport({ width: 1100, height: 900 });
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
const ok = (cond, msg) => console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
const toSec = (t) => t.trim().split(":").reduce((a, x) => a * 60 + Number(x), 0);
// Short polls: one long wait hits Puppeteer's protocol timeout.
async function waitFor(fn, ms = 300_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// cancel while live results are showing (searching first, while the analysis runs)
await (await page.$("input[type=file]")).uploadFile(path.resolve(longFile));
const liveRows = await waitFor(() => document.querySelectorAll(".trow").length || null, 60_000);
await page.type("#search", "vehicle");
const liveSearch = await waitFor(() => document.querySelector(".search__head span")?.textContent, 10_000);
ok(!!liveSearch && /so far/.test(liveSearch), `search during analysis: ${liveSearch}`);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel").click());
await new Promise((r) => setTimeout(r, 500));
const after = await page.evaluate(() => ({ results: !!document.querySelector(".workspace"), drop: !!document.querySelector(".dropzone") }));
ok(liveRows && !after.results && after.drop, `cancel during live results: ${liveRows} rows seen, after cancel ${JSON.stringify(after)}`);

// full run, then play a moment at least 5 s in
await (await page.$("input[type=file]")).uploadFile(path.resolve(file));
const last = await waitFor(() => window.__soundscopeLast);
await waitFor(() => !!(window.__soundscopePlayer && document.querySelector(".moment:not(:disabled)")));
const rows = await page.$$eval(".trow__label", (els) => els.map((e) => e.textContent));
const moments = await page.$$eval(".moment > span:first-child", (els) => els.map((e) => e.textContent));
const i = Math.max(0, moments.findIndex((m) => toSec(m.split("–")[0]) >= 5));
// search + combined row
await page.type("#search", "wind");
await waitFor(() => !!document.querySelector(".search__head button"), 10_000);
await page.click(".search__head button");
const combined = await waitFor(() => [...document.querySelectorAll(".trow__label")].map((b) => b.textContent).find((t) => t.startsWith("“wind”")), 10_000);
ok(!!combined, `search "wind" as one row: ${combined}`);
await page.focus("#search");
await page.keyboard.press("Escape"); // close the search results, which cover the lanes
await page.click(".trow__label"); // back to the first row for the playback check
if (process.env.SS_VERBOSE) console.log("      active:", await page.$eval(".moments__title", (e) => e.textContent), "| popover:", await page.$(".search__results") ? "open" : "closed");
await (await page.$$(".moment"))[i].click();
await new Promise((r) => setTimeout(r, 600));
const p = await page.evaluate(() => ({ t: window.__soundscopePlayer.time(), playing: window.__soundscopePlayer.playing() }));
const start = toSec(moments[i].split("–")[0]);
ok(last.ok && rows.length > 0 && p.playing && p.t >= start - 0.1 && p.t < start + 1,
  `full run ${(last.timings.totalMs / 1000).toFixed(1)} s, rows ${JSON.stringify(rows)}, moment at ${start.toFixed(1)} s -> playing from ${p.t.toFixed(2)} s`);
if (shot) await page.screenshot({ path: shot });
await browser.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still locked */ }
