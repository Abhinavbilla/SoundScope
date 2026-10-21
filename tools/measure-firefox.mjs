// Same as measure-decode.mjs, but in the installed (stock) Firefox via Puppeteer + WebDriver BiDi
// (Playwright can only drive its own patched Firefox build).
// Needs `vite preview` on :4173. Usage: node tools/measure-firefox.mjs <file> [<file> ...]
// Env: SS_LOCAL_MODEL=1, SS_PRIVATE=1 (private browsing window), SS_REOPEN=1 (reload and open the file again)
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIREFOX = "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const MB = (b) => Math.round(b / 1048576);

async function measure(file) {
  const marker = "ssprobe-ffstock-" + Date.now();
  const userDir = path.join(os.tmpdir(), marker);
  fs.mkdirSync(userDir);
  const samples = [];
  const poller = spawn("powershell", ["-NoProfile", "-File", "tools/memory-poll.ps1", "-Marker", marker, "-Name", "firefox.exe"]);
  poller.stdout.on("data", (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      const [t, tot, ren] = line.split(",").map(Number);
      if (t) samples.push({ t, tot: tot || 0, ren: ren || 0 });
    }
  });

  const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: false, userDataDir: userDir,
    extraPrefsFirefox: process.env.SS_PRIVATE ? { "browser.privatebrowsing.autostart": true } : {} });
  const page = (await browser.pages())[0] || (await browser.newPage());
  await page.evaluateOnNewDocument((local) => {
    window.__soundscopeDebug = true;
    if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; // SS_LOCAL_MODEL=1
  }, !!process.env.SS_LOCAL_MODEL);
  await page.goto("http://localhost:4173/");
  await new Promise((r) => setTimeout(r, 2500));
  const ua = await page.evaluate(() => navigator.userAgent);
  const caps = await page.evaluate(() => ({
    isolated: self.crossOriginIsolated,
    webcodecsAudio: typeof AudioDecoder !== "undefined",
  }));

  const t0 = Date.now();
  const input = await page.$("input[type=file]");
  await input.uploadFile(path.resolve(file));
  const result = await waitResult(page);
  const tDone = Date.now();
  let shown = null;
  if (result.ok) shown = await page.$eval("[data-testid=duration]", (el) => el.textContent).catch(() => null);
  const during = samples.filter((s) => s.t >= t0 && s.t <= tDone + 2000);
  let reopen;
  if (process.env.SS_REOPEN && result.ok) {
    await page.reload();
    await new Promise((r) => setTimeout(r, 1500));
    const t1 = Date.now();
    await (await page.$("input[type=file]")).uploadFile(path.resolve(file));
    const again = await waitResult(page);
    reopen = { path: again.path, seconds: +((Date.now() - t1) / 1000).toFixed(2) };
  }
  const privateMode = process.env.SS_PRIVATE
    ? await page.evaluate(async () => ({ opfs: await navigator.storage.getDirectory().then(() => "ok", (e) => e.name) })) : undefined;
  await browser.close();
  poller.kill();
  await new Promise((r) => setTimeout(r, 1500));
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* still locked: left in temp */ }

  const t = result.timings || {};
  return {
    file: path.basename(file), ua: ua.slice(-24), ...caps,
    ok: result.ok, path: result.path, hasVideo: result.hasVideo, stored: result.stored, storeReason: result.storeReason,
    reopen, privateMode, shown, message: result.ok ? undefined : (result.message || result.harness), detail: result.detail,
    wallSeconds: +((tDone - t0) / 1000).toFixed(1),
    modelSecPerMin: t.inferenceMs && result.duration ? +(t.inferenceMs / 1000 / (result.duration / 60)).toFixed(2) : null,
    threads: t.threads,
    pagePeakMB: during.length ? MB(Math.max(...during.map((s) => s.ren))) : null,
    allFirefoxPeakMB: during.length ? MB(Math.max(...during.map((s) => s.tot))) : null,
  };
}

async function waitResult(page) {
  // Poll with short evaluate calls: one long waitForFunction hits Puppeteer's 180 s protocol timeout.
  let result = null;
  const deadline = Date.now() + 15 * 60_000;
  while (!result && Date.now() < deadline) {
    try {
      result = await page.evaluate(() => window.__soundscopeLast || null);
    } catch (e) {
      result = { ok: false, harness: String(e).slice(0, 200) };
    }
    if (!result) await new Promise((r) => setTimeout(r, 1000));
  }
  return result ?? { ok: false, harness: "no result after 15 min" };
}

for (const f of process.argv.slice(2)) console.log(JSON.stringify(await measure(f)));
