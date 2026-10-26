// Step 6 in stock Firefox (Puppeteer + BiDi): bookmarks, CSV and clips. Firefox has no folder picker,
// so clips go out as separate downloads; this test catches each download inside the page (anchor click)
// and writes it to outDir, so tools/verify_clips.py can check it.
// Needs `vite preview` on :4173. Usage: node tools/check-bookmarks-firefox.mjs <outDir> <file> [<at seconds> ...]
// Env: SS_LOCAL_MODEL=1
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [outDir, file, ...ats] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const ok = (cond, msg) => console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
const stage = (msg) => process.env.SS_VERBOSE && console.log(`      ... ${msg}`);
const dir = path.join(os.tmpdir(), "ssprobe-ffbm-" + Date.now());
process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use */ } }); // no leftover browser profiles
fs.mkdirSync(dir);
const browser = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: false, userDataDir: dir });
const page = (await browser.pages())[0];
await page.setViewport({ width: 1100, height: 900 });
await page.evaluateOnNewDocument((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
  // test only: keep downloads in the page instead of saving them
  window.__downloads = [];
  HTMLAnchorElement.prototype.click = function () {
    // read it now: the app frees the URL after a few seconds
    if (this.download) window.__downloads.push({ name: this.download, data: fetch(this.href).then((r) => r.arrayBuffer()) });
  };
}, !!process.env.SS_LOCAL_MODEL);
async function waitFor(fn, ms = 300_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
async function saveDownloads() {
  const got = await page.evaluate(async () => {
    const out = [];
    for (const d of window.__downloads.splice(0)) {
      const buf = new Uint8Array(await d.data);
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      out.push({ name: d.name, b64: btoa(s) });
    }
    return out;
  });
  for (const d of got) fs.writeFileSync(path.join(outDir, d.name), Buffer.from(d.b64, "base64"));
  return got.map((d) => d.name);
}

await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
stage("page loaded");
await (await page.$("input[type=file]")).uploadFile(path.resolve(file));
const last = await waitFor(() => window.__soundscopeLast);
stage(`analysed: ${JSON.stringify(last && { ok: last.ok, message: last.message })}`);
if (!last?.ok) { console.log(`FAIL  analysis: ${last?.message}`); process.exit(1); }
if (!(await waitFor(() => !!(window.__soundscopePlayer && document.querySelector(".star:not(:disabled)")), 60_000))) {
  const st = await page.evaluate(() => ({ player: !!window.__soundscopePlayer, stars: document.querySelectorAll(".star").length,
    enabled: document.querySelectorAll(".star:not(:disabled)").length, moments: document.querySelectorAll(".moment").length,
    bookmarksPanel: document.querySelector(".bookmarks")?.textContent.slice(0, 200) }));
  console.log(`FAIL  no bookmark star to click: ${JSON.stringify(st)}`);
  process.exit(1);
}
stage("player ready");
await page.click(".star");
for (const at of ats) {
  await page.evaluate((t) => { window.__soundscopePlayer.playFrom(Number(t)); document.querySelectorAll("audio,video").forEach((m) => m.pause()); }, at);
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => document.querySelectorAll("audio,video").forEach((m) => m.pause()));
  await page.evaluate(() => [...document.querySelectorAll(".tab")].find((b) => b.textContent.includes("Bookmarks")).click());
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => [...document.querySelectorAll(".bookmarks button")].find((b) => b.textContent.trim() === "Bookmark this point").click());
  await new Promise((r) => setTimeout(r, 300));
}
stage("bookmarked");
await page.reload();
await (await page.$("input[type=file]")).uploadFile(path.resolve(file));
await waitFor(() => !!window.__soundscopePlayer && document.querySelectorAll(".tab").length > 1);
stage("reopened");
await page.evaluate(() => [...document.querySelectorAll(".tab")].find((b) => b.textContent.includes("Bookmarks")).click());
await new Promise((r) => setTimeout(r, 300));
const n = await page.$$eval(".bookmark", (els) => els.length);
ok(n === 1 + ats.length, `bookmarks after reopening: ${n}`);
await page.evaluate(() => [...document.querySelectorAll(".bookmarks button")].find((b) => b.textContent.trim() === "Download list").click());
await page.evaluate(() => [...document.querySelectorAll(".bookmarks button")].find((b) => b.textContent.trim() === "Download all clips").click());
const status = await waitFor(() => /\d+ clips saved|Clip saved|couldn/.test(document.querySelector(".toasts")?.textContent ?? "")
  && document.querySelector(".toasts").textContent, 300_000);
const files = await saveDownloads();
ok(files.length === n + 1 && /saved/.test(status ?? ""), `Firefox: ${status}; files ${JSON.stringify(files)}`);
await browser.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still locked */ }
