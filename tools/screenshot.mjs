// Screenshots of the app while decoding and after. Usage: node tools/screenshot.mjs <file> <outPrefix>
import { chromium } from "playwright-core";
const [file, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 520 } });
await page.addInitScript(() => { window.__soundscopeDebug = true; });
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.setInputFiles("input[type=file]", file);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}-progress.png` });
await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 600000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-done.png` });
await browser.close();
