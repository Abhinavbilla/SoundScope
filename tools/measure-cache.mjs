// Does the model come from the Cache API on the second visit? Loads the same short file twice
// in one browser profile, reloading the page in between.
// Needs `vite preview` on :4173. Usage: node tools/measure-cache.mjs <shortFile>
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = process.argv[2];
const dir = path.join(os.tmpdir(), "ssprobe-cache-" + Date.now());
const ctx = await chromium.launchPersistentContext(dir, { channel: "msedge", headless: false });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript(() => { window.__soundscopeDebug = true; });
for (const visit of [1, 2]) {
  await page.goto("http://localhost:4173/");
  await page.setInputFiles("input[type=file]", file);
  await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 300000 });
  const t = await page.evaluate(() => window.__soundscopeLast.timings);
  console.log(`visit ${visit}: model from cache ${t.modelFromCache}, model load ${Math.round(t.modelLoadMs)} ms`);
}
const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
console.log(`storage used by the site: ${Math.round(usage / 1048576)} MB`);
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
