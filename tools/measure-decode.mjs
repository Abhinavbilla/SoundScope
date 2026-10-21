// Measure decode/analysis time and memory for real files in a browser.
// Needs `vite preview` running on :4173. Usage: node tools/measure-decode.mjs <file> [<file> ...]
// Env: SS_BROWSER=msedge|chrome|firefox|webkit (default msedge), SS_HEADED=1 (visible window),
//      SS_FALLBACK=1 (old whole-file decoder), SS_BACKGROUND=1 (another tab in front),
//      SS_THREADS=n (model threads), SS_CPU_THROTTLE=n (Chromium only: CPU n times slower).
// Each file runs in a fresh browser. Memory comes from the OS (private bytes of that browser's processes).
import { chromium, firefox, webkit } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = "http://localhost:4173/";
const BROWSER = process.env.SS_BROWSER || "msedge";
const PROCESS_NAME = { msedge: "msedge.exe", chrome: "chrome.exe", firefox: "firefox.exe", webkit: "none" }[BROWSER];
const MB = (b) => Math.round(b / 1048576);

function systemCommit() {
  // execFileSync, not execSync: avoids the shell (ComSpec is broken on the test machine)
  const out = execFileSync("powershell", ["-NoProfile", "-c",
    "$c=Get-Counter '\\Memory\\Committed Bytes','\\Memory\\Commit Limit'; ($c.CounterSamples | % { [int64]$_.CookedValue }) -join ','"],
  ).toString().trim().split(",").map(Number);
  return { committedMB: MB(out[0]), limitMB: MB(out[1]) };
}

async function measure(file) {
  const marker = "ssprobe-" + Date.now();
  const userDir = path.join(os.tmpdir(), marker);
  const samples = [];
  const poller = spawn("powershell", ["-NoProfile", "-File", "tools/memory-poll.ps1", "-Marker", marker, "-Name", PROCESS_NAME]);
  poller.stdout.on("data", (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      const [t, tot, ren, ws] = line.split(",").map(Number);
      if (t) samples.push({ t, tot: tot || 0, ren: ren || 0, ws: ws || 0 });
    }
  });

  const commitBefore = systemCommit();
  const headless = !process.env.SS_HEADED;
  const ctx = BROWSER === "firefox" ? await firefox.launchPersistentContext(userDir, { headless })
    : BROWSER === "webkit" ? await webkit.launchPersistentContext(userDir, { headless })
    : await chromium.launchPersistentContext(userDir, { channel: BROWSER, headless });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let crashed = false;
  page.on("crash", () => { crashed = true; });
  await page.addInitScript(([fallback, threads, drop, local, decodeOnly, noStreamReader]) => {
    window.__soundscopeDebug = true;
    if (fallback) window.__soundscopeForceFallback = true; // SS_FALLBACK=1: old whole-file decoder
    if (threads) window.__soundscopeThreads = threads;
    if (drop) window.__soundscopeNoStore = true; // SS_NO_STORE=1: don't save full scores (overview only)
    if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; // SS_LOCAL_MODEL=1
    if (decodeOnly) window.__soundscopeDecodeOnly = true; // SS_DECODE_ONLY=1
    if (noStreamReader) window.__soundscopeNoStreamReader = true; // SS_NO_STREAM_READER=1: read only the byte ranges needed
  }, [!!process.env.SS_FALLBACK, Number(process.env.SS_THREADS) || 0, !!process.env.SS_NO_STORE, !!process.env.SS_LOCAL_MODEL,
    !!process.env.SS_DECODE_ONLY, !!process.env.SS_NO_STREAM_READER]);
  if (process.env.SS_CPU_THROTTLE && BROWSER !== "firefox" && BROWSER !== "webkit") {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.SS_CPU_THROTTLE) });
  }
  await page.goto(URL);
  await page.waitForTimeout(2500);
  const tBase = Date.now();
  const base = samples.filter((s) => s.t <= tBase).slice(-3);

  const t0 = Date.now();
  await page.setInputFiles("input[type=file]", file);
  if (process.env.SS_BACKGROUND) {
    // SS_BACKGROUND=1: put another tab in front, like a user switching away during analysis
    const other = await ctx.newPage();
    await other.goto("about:blank");
    await other.bringToFront();
  }
  let result;
  try {
    await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 15 * 60_000, polling: 250 });
    result = await page.evaluate(() => window.__soundscopeLast);
  } catch (e) {
    result = { ok: false, harness: crashed ? "renderer crashed" : String(e).slice(0, 200) };
  }
  const tDone = Date.now();
  let shown = null;
  if (result.ok) {
    await page.waitForSelector(".waveform canvas, .waveform div", { timeout: 60_000 }).catch(() => {});
    shown = await page.textContent("[data-testid=duration]").catch(() => null);
  }
  await page.waitForTimeout(3000); // let memory settle after the waveform draws
  const tEnd = Date.now();
  let uaMemoryMB = null;
  if (result.ok) {
    uaMemoryMB = await page.evaluate(async () => {
      if (!self.crossOriginIsolated || !performance.measureUserAgentSpecificMemory) return null;
      const m = await performance.measureUserAgentSpecificMemory();
      return Math.round(m.bytes / 1048576);
    }).catch(() => null);
  }
  const during = samples.filter((s) => s.t >= t0 && s.t <= tEnd);
  const after = samples.filter((s) => s.t >= tEnd - 1500 && s.t <= tEnd);
  await ctx.close();
  poller.kill();
  fs.rmSync(userDir, { recursive: true, force: true });

  const peak = (k, arr) => (arr.length ? MB(Math.max(...arr.map((s) => s[k]))) : null);
  // SS_TIMELINE=1: page memory every ~10% of the run, to see steady growth vs a spike at the end
  const timeline = process.env.SS_TIMELINE && during.length
    ? Array.from({ length: 11 }, (_, i) => {
      const s = during[Math.min(during.length - 1, Math.floor((i / 10) * (during.length - 1)))];
      return `${Math.round(((s.t - t0) / (tEnd - t0)) * 100)}%:${MB(s.ren)}`;
    }).join(" ")
    : undefined;
  return {
    file: path.basename(file),
    fileMB: MB(fs.statSync(file).size),
    result,
    durationShown: shown,
    wallSeconds: +((tDone - t0) / 1000).toFixed(1),
    memMB: {
      rendererBaseline: peak("ren", base),
      rendererPeak: peak("ren", during),
      rendererAfter: peak("ren", after),
      allEdgeBaseline: peak("tot", base),
      allEdgePeak: peak("tot", during),
      pageMemoryAfter_measureUserAgentSpecificMemory: uaMemoryMB,
      pollSamples: during.length,
      timeline,
    },
    systemCommitBefore: commitBefore,
  };
}

for (const f of process.argv.slice(2)) {
  const r = await measure(f);
  console.log(JSON.stringify(r));
}
