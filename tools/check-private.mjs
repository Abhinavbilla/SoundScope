// Chrome/Edge incognito (off-the-record context): analyse a file, then reload and open it again.
// Also checks the model cache and storage quota there. Optional SS_QUOTA_MB caps the site's storage quota
// for real through DevTools (Storage.overrideQuotaForOrigin), to test a genuinely full storage.
// Needs `vite preview` on :4173. Usage: node tools/check-private.mjs <file>   Env: SS_BROWSER=msedge|chrome
import { chromium } from "playwright-core";

const file = process.argv[2];
const browser = await chromium.launch({ channel: process.env.SS_BROWSER || "msedge", headless: false });
const ctx = await browser.newContext(); // incognito-style context
const page = await ctx.newPage();
await page.addInitScript(() => { window.__soundscopeDebug = true; });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("  [console]", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
if (process.env.SS_QUOTA_MB) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Storage.overrideQuotaForOrigin",
    { origin: "http://localhost:4173", quotaSize: Number(process.env.SS_QUOTA_MB) * 1048576 });
}

async function openOnce(label) {
  await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
  const t0 = Date.now();
  await page.setInputFiles("input[type=file]", file);
  const ticker = setInterval(async () => {
    const t = await page.textContent("main").catch(() => "");
    console.log(`  [${Math.round((Date.now() - t0) / 1000)} s]`, t.replace(/\s+/g, " ").slice(0, 160));
  }, 15000);
  await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: Number(process.env.SS_TIMEOUT_S || 900) * 1000, polling: 250 })
    .finally(() => clearInterval(ticker));
  const last = await page.evaluate(() => window.__soundscopeLast);
  await page.waitForTimeout(1000); // let the clean-up after a failed save finish
  const note = await page.textContent(".result").catch(() => "");
  const env = await page.evaluate(async () => {
    const est = await navigator.storage.estimate();
    const caches = await self.caches.keys().catch((e) => e.name);
    const files = [];
    try {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("results");
      for await (const [name, h] of d.entries()) files.push(`${name}:${Math.round((await h.getFile()).size / 1024)}K`);
    } catch (e) { files.push(e.name); }
    return { usageMB: +(est.usage / 1048576).toFixed(1), quotaMB: Math.round(est.quota / 1048576), caches, files };
  });
  console.log(JSON.stringify({ label, ok: last.ok, path: last.path, stored: last.stored, storeReason: last.storeReason,
    message: last.message, model: last.timings?.modelFromCache, wall: +((Date.now() - t0) / 1000).toFixed(2), ...env,
    note: /won't be kept[^.]*\./.exec(note)?.[0] }));
}

await openOnce("first open");
await openOnce("second open (after reload)");
await browser.close();
