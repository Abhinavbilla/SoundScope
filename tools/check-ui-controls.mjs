// Checks for the redesigned UI's controls: keyboard shortcuts, transport buttons, playback speed,
// always-light page (even with a dark system setting), drop-anywhere, and that no raw scores or technical details are shown.
// Needs `vite preview` on :4173. Usage: node tools/check-ui-controls.mjs <file>   Env: SS_LOCAL_MODEL=1
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = process.argv[2];
const ok = (cond, msg) => console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
const dir = path.join(os.tmpdir(), "ssprobe-ui-" + Date.now());
process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use */ } }); // no leftover browser profiles
const ctx = await chromium.launchPersistentContext(dir, { channel: "msedge", headless: false, viewport: { width: 1280, height: 900 } });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
}, !!process.env.SS_LOCAL_MODEL);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");

// drop a file anywhere on the page
const buf = fs.readFileSync(file);
const dt = await page.evaluateHandle(({ b64, name }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const d = new DataTransfer();
  d.items.add(new File([bytes], name, { type: "audio/wav" }));
  return d;
}, { b64: buf.toString("base64"), name: path.basename(file) });
await page.dispatchEvent("body", "dragenter", { dataTransfer: dt });
const overlay = await page.isVisible(".dropzone-overlay");
await page.dispatchEvent("body", "drop", { dataTransfer: dt });
await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 300_000 });
ok(overlay && (await page.evaluate(() => window.__soundscopeLast.ok)), `drop anywhere: overlay shown ${overlay}, file opened`);

const time = () => page.evaluate(() => window.__soundscopePlayer.time());
const playing = () => page.evaluate(() => window.__soundscopePlayer.playing());
await page.click("body", { position: { x: 5, y: 600 } }); // focus the page, not a control
await page.keyboard.press("Space");
await page.waitForTimeout(500);
const p1 = await playing();
await page.keyboard.press("Space");
await page.waitForTimeout(200);
ok(p1 && !(await playing()), "Space plays and pauses");
const t0 = await time();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
const t1 = await time();
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(150);
ok(Math.abs(t1 - t0 - 5) < 0.3 && Math.abs((await time()) - t0) < 0.3, `arrows skip 5 s (${t0.toFixed(1)} -> ${t1.toFixed(1)} -> back)`);
await page.keyboard.press("/");
ok(await page.evaluate(() => document.activeElement?.id === "search"), "/ focuses the search");
await page.keyboard.press("Escape");
await page.click("body", { position: { x: 5, y: 600 } });
await page.keyboard.press("Control+k");
ok(await page.evaluate(() => document.activeElement?.id === "search"), "Ctrl+K focuses the search");
await page.keyboard.press("Escape");

await page.click(".play-btn");
await page.waitForTimeout(400);
const pb = await playing();
await page.click(".play-btn");
const before = await time();
await page.click('[aria-label="Forward 5 seconds"]');
await page.waitForTimeout(150);
ok(pb && Math.abs((await time()) - before - 5) < 0.3, "play button and forward button work");
await page.click('[aria-label^="Playback speed"]');
const rate = await page.evaluate(() => document.querySelector('[aria-label^="Playback speed"]').textContent.trim());
ok(rate === "1.5×", `playback speed button: ${rate}`);

// always light: the background stays the same with a dark system setting, and there's no theme switch
const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.emulateMedia({ colorScheme: "dark" });
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.emulateMedia({ colorScheme: "light" });
const switches = await page.locator('[aria-label="Theme"]').count();
ok(lightBg === darkBg && switches === 0, `always light: ${lightBg} with light system, ${darkBg} with dark system, theme switches: ${switches}`);

// nothing technical on screen: no raw scores, sample rates or timings
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 300_000 });
await page.waitForTimeout(500);
const text = await page.evaluate(() => document.querySelector(".app").innerText);
const leaks = [/\b0\.\d{2}\b/, /kHz/, /score/i, /analysed in/i, /channels/i, /threshold/i, /\bms\b/].filter((r) => r.test(text)).map(String);
ok(leaks.length === 0, `no technical values on screen${leaks.length ? `: found ${leaks.join(", ")}` : ""}`);
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
