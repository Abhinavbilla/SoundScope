// Open a video, check the player is shown, click the waveform at 25% and 75%, and read the video's time.
// Needs `vite preview` on :4173. Usage: node tools/check-video-player.mjs <video> <screenshotPath>
import { chromium } from "playwright-core";
const [file, shot] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge", headless: false });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.addInitScript(() => { window.__soundscopeDebug = true; window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; });
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 300000 });
await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 30000 });
const info = await page.evaluate(() => {
  const v = document.querySelector("video");
  return { videoShown: !!v, duration: v.duration, width: v.videoWidth, height: v.videoHeight };
});
const box = await page.locator(".waveform").boundingBox();
const seeks = [];
for (const f of [0.25, 0.75]) {
  await page.mouse.click(box.x + box.width * f, box.y + box.height / 2);
  await page.waitForTimeout(800);
  seeks.push(+(await page.evaluate(() => document.querySelector("video").currentTime)).toFixed(1));
}
await page.screenshot({ path: shot });
console.log(JSON.stringify({ ...info, clickedAt: ["25%", "75%"], videoTimeAfterClick: seeks }));
await browser.close();
