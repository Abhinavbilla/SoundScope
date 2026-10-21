// Start analysing, press Cancel, and check the app returns to the file picker and stops working.
import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: false });
const page = await browser.newPage();
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.setInputFiles("input[type=file]", process.argv[2]);
await page.waitForSelector(".progress", { timeout: 60000 });
await page.waitForTimeout(3000);
const before = await page.textContent(".progress p");
await page.click("text=Cancel");
await page.waitForTimeout(1500);
const pickerBack = await page.isVisible("text=Open a file");
const progressGone = !(await page.isVisible(".progress"));
console.log(JSON.stringify({ progressBeforeCancel: before.trim(), pickerBack, progressGone }));
await browser.close();
