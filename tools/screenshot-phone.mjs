// Layout check at phone sizes (Chromium device emulation: screen size, touch, pixel ratio only;
// NOT a real phone's CPU, memory or codecs). Usage: node tools/screenshot-phone.mjs <file> <outDir>
import { chromium, devices } from "playwright-core";
const [file, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const name of ["Pixel 7", "iPhone 14", "Galaxy S9+"]) {
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__soundscopeDebug = true; });
  await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
  const slug = name.replace(/\W+/g, "-");
  await page.screenshot({ path: `${out}/phone-${slug}-1-empty.png` });
  await page.setInputFiles("input[type=file]", file);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/phone-${slug}-2-progress.png` });
  await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 300000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/phone-${slug}-3-done.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(name, devices[name].viewport, "horizontal overflow:", overflow);
  await ctx.close();
}
await browser.close();
