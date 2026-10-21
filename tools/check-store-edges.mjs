// Edge cases for saved results: cancel cleanup, no OPFS, storage full.
// Needs `vite preview` on :4173. Usage: node tools/check-store-edges.mjs <longFile> <shortFile>
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [longFile, shortFile] = process.argv.slice(2);
const dir = path.join(os.tmpdir(), "ssprobe-edges-" + Date.now());
const ctx = await chromium.launchPersistentContext(dir, { channel: "msedge", headless: false });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript(() => { window.__soundscopeDebug = true; window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; });
const opfs = () => page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const d = await root.getDirectoryHandle("results", { create: true });
  const out = [];
  for await (const [name, h] of d.entries()) out.push(`${name} ${(await h.getFile()).size}`);
  return out.sort();
});
const run = async (f, flags = {}) => {
  await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
  await page.evaluate((flags) => { window.__soundscopeLast = undefined; Object.assign(window, flags); }, flags);
  await page.setInputFiles("input[type=file]", f);
  await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 600000 });
  const last = await page.evaluate(() => window.__soundscopeLast);
  const note = await page.$eval(".result", (el) => el.innerText.split("\n").filter((l) => /detail|storage/i.test(l)).join(" | ")).catch(() => "");
  return { path: last.path, stored: last.stored, reason: last.storeReason, note };
};

// 1. cancel a long run halfway, then check what is left in storage
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.setInputFiles("input[type=file]", longFile);
await page.waitForSelector(".progress", { timeout: 60000 });
await page.waitForTimeout(8000);
await page.click("text=Cancel");
await page.waitForTimeout(1500);
console.log("1a after cancel, OPFS:", JSON.stringify(await opfs()));
console.log("1b next analysis:", JSON.stringify(await run(shortFile)));
console.log("1c OPFS now:", JSON.stringify(await opfs()));
// 2. no OPFS (simulated)
console.log("2  no storage:", JSON.stringify(await run(shortFile, { __soundscopeNoStore: true })));
// 3. storage full (simulated), on a different file so the saved result isn't reused
console.log("3  storage full:", JSON.stringify(await run(longFile, { __soundscopeNoSpace: true })));
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
