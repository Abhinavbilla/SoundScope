// Typos in the search box: "anmal" shows animal sounds with "Showing results for “animal”", and clicking
// the suggestion puts it in the box. Needs `vite preview` on :4173.
// Usage: node tools/check-search-typos.mjs <file> [screenshot.png]   Env: SS_LOCAL_MODEL=1, SS_WIDTH
import { chromium } from "playwright-core";

const [file, shot] = process.argv.slice(2);
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
const b = await chromium.launch({ channel: "msedge", headless: false });
const page = await b.newPage({ viewport: { width: Number(process.env.SS_WIDTH) || 1280, height: 900 } });
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
}, !!process.env.SS_LOCAL_MODEL);
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 600_000 });

for (const [typed, meant] of [["anmal", "animal"], ["dgo", "dog"], ["sirne", "siren"]]) {
  await page.fill("#search", typed);
  await page.waitForTimeout(400);
  const fix = await page.$eval(".search__results", (el) => el.querySelector(".search__fix")?.textContent ?? "");
  const n = await page.$$eval(".search__list li", (els) => els.length);
  ok(fix.includes(`“${meant}”`) && n > 0, `"${typed}": ${JSON.stringify(fix)}, ${n} sounds listed`);
}
await page.fill("#search", "anmal");
await page.waitForTimeout(400);
if (shot) await page.screenshot({ path: shot });
await page.click(".search__fix .link-btn");
await page.waitForTimeout(400);
const value = await page.inputValue("#search");
const fixAfter = await page.$$eval(".search__fix", (els) => els.length);
ok(value === "animal" && fixAfter === 0, `clicking the suggestion: box says "${value}", suggestion line gone: ${fixAfter === 0}`);
await page.fill("#search", "dog");
await page.waitForTimeout(400);
ok((await page.$$eval(".search__fix", (els) => els.length)) === 0, `"dog" (spelled right): no suggestion line`);
await b.close();
