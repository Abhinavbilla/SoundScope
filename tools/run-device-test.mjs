// Run device-test.html in a desktop browser (to check the page itself). Usage: node tools/run-device-test.mjs [long]
import { chromium, devices } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: false });
const ctx = await browser.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
await page.goto("http://localhost:4173/device-test.html");
await page.click("#run");
await page.waitForFunction(() => document.querySelectorAll("#out li").length >= 8 &&
  !document.querySelector("#run").disabled, null, { timeout: 600000, polling: 1000 });
console.log(await page.$$eval("#caps li, #out li", (els) => els.map((e) => e.innerText.replace(/\n/g, ": ")).join("\n")));
if (process.argv[2] === "long") {
  await page.click("#long");
  await page.waitForFunction(() => !document.querySelector("#long").disabled && document.querySelector("#longout li"),
    null, { timeout: 900000, polling: 2000 });
  console.log(await page.$eval("#longout", (e) => e.innerText));
}
await page.screenshot({ path: process.env.SHOT || "device-test.png", fullPage: true });
await browser.close();
