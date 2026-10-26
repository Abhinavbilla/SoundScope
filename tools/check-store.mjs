// Saved results in OPFS: analyse a file, time reading single sounds' full timelines from storage,
// check storage size, then reload and open the same file again (should be instant, "saved").
// Needs `vite preview` on :4173. Usage: node tools/check-store.mjs <file>
// SS_LOCAL_MODEL=1 loads the model from /models/ instead of Hugging Face.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = process.argv[2];
const dir = path.join(os.tmpdir(), "ssprobe-store-" + Date.now());
process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use */ } }); // no leftover browser profiles
const ctx = await chromium.launchPersistentContext(dir, { channel: process.env.SS_BROWSER || "msedge", headless: false });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
}, !!process.env.SS_LOCAL_MODEL);

async function openOnce(label) {
  await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
  await page.evaluate(() => { window.__soundscopeLast = undefined; });
  const t0 = Date.now();
  await page.setInputFiles("input[type=file]", file);
  await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 30 * 60_000, polling: 250 });
  const last = await page.evaluate(() => window.__soundscopeLast);
  console.log(`${label}: path=${last.path} stored=${last.stored} video=${last.hasVideo} rows=${last.rows} ` +
    `app time ${(last.timings.totalMs / 1000).toFixed(2)} s, wall ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  return last;
}

await openOnce("first open");
// a few classes spread over the list
const reads = await page.evaluate(async () => {
  const labels = window.__soundscopeResult.classes;
  const out = [];
  for (const c of [0, 100, 300, labels - 1]) out.push(await window.__soundscopeReadClass(c));
  out.push(await window.__soundscopeReadClass(100)); // again (OS file cache warm)
  return out;
});
console.log("read one sound's full timeline:", reads.map((r) => `${r.rows} rows in ${r.ms.toFixed(1)} ms`).join(", "));
const storage = await page.evaluate(async () => {
  const est = await navigator.storage.estimate();
  return { usageMB: +(est.usage / 1048576).toFixed(1), quotaMB: Math.round(est.quota / 1048576) };
});
console.log("site storage:", JSON.stringify(storage));
await openOnce("second open (same file, after reload)");
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
