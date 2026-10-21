// Check a deployed (or locally served) public build: cross-origin isolation, no blocked requests or
// Content-Security-Policy errors, the model downloads from the site itself (not Hugging Face) and passes
// its hash check, an audio file and a video analyse, a reload takes the model from the cache, and the
// test-only files aren't published. Usage: node tools/check-site.mjs <base url> <audio file> <video file>
// Env: SS_BROWSER=msedge|chrome|firefox
import { chromium, firefox } from "playwright-core";
import os from "node:os";
import path from "node:path";

const [base, audio, video] = process.argv.slice(2);
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
const which = process.env.SS_BROWSER || "msedge";
const dir = path.join(os.tmpdir(), "ssprobe-site-" + Date.now());
const ctx = which === "firefox"
  ? await firefox.launchPersistentContext(dir, { headless: false })
  : await chromium.launchPersistentContext(dir, { channel: which, headless: false });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript(() => {
  window.__soundscopeDebug = true;
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const problems = [];
const requests = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => problems.push(`page: ${String(e).slice(0, 200)}`));
// Loads cut off on purpose aren't problems: the player's blob: loads when a new file opens, and the icon
// or font when the test moves to the next page. (That the font does load is checked below.)
page.on("requestfailed", (r) => { if (!/ABORTED/.test(r.failure()?.errorText ?? "")) problems.push(`failed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`); });
ctx.on("request", (r) => requests.push(r.url()));

async function analyse(file) {
  await page.goto(base + "/");
  await page.setInputFiles("input[type=file]", file);
  await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 600_000 });
  return page.evaluate(() => window.__soundscopeLast);
}

await page.goto(base + "/");
const iso = await page.evaluate(() => ({ isolated: self.crossOriginIsolated, secure: self.isSecureContext }));
ok(iso.isolated && iso.secure, `cross-origin isolated (multi-threaded analysis): ${JSON.stringify(iso)}`);
await page.evaluate(() => document.fonts.ready);
const font = await page.evaluate(() => [...document.fonts].some((f) => /Inter/.test(f.family) && f.status === "loaded"));
ok(font, "Inter font loaded");

let t = Date.now();
const a = await analyse(audio);
ok(a.ok && a.rows > 0, `audio ${path.basename(audio)}: ${a.ok ? `${a.duration.toFixed(0)} s analysed in ${((Date.now() - t) / 1000).toFixed(1)} s, saved: ${a.stored}` : a.message}`);
const modelReqs = requests.filter((u) => /\.onnx/.test(u));
ok(modelReqs.length > 0 && modelReqs.every((u) => u.startsWith(base)), `model downloaded from the site: ${modelReqs.map((u) => u.replace(base, "")).join(", ")}`);

t = Date.now();
const v = await analyse(video);
ok(v.ok && v.hasVideo, `video ${path.basename(video)}: ${v.ok ? `${v.duration.toFixed(0)} s in ${((Date.now() - t) / 1000).toFixed(1)} s, picture shown: ${await page.$$eval("video", (e) => e.length) > 0}` : v.message}`);

const before = requests.filter((u) => /\.onnx/.test(u)).length;
await analyse(audio);
ok(requests.filter((u) => /\.onnx/.test(u)).length === before, "reopen after reload: model came from the browser's cache (no new download)");

const others = [...new Set(requests.map((u) => new URL(u).origin))].filter((o) => o !== new URL(base).origin && !o.startsWith("blob:") && o !== "null");
ok(others.length === 0, `no requests to other sites: ${others.join(", ") || "none"}`);
const csp = await page.evaluate(() => window.__csp);
ok(csp.length === 0, `no Content-Security-Policy blocks: ${csp.join("; ") || "none"}`);
ok(problems.length === 0, `no errors or failed requests${problems.length ? `:\n    ${problems.join("\n    ")}` : ""}`);

for (const p of ["/device-test.html", "/models/frame_mn10.onnx", "/models/clip_b32_vision_int8.onnx", "/device-samples/clip.mp3"]) {
  const r = await page.request.get(base + p);
  const body = await r.body();
  // a 404 (Render) or the app page itself (Cloudflare Pages, local server) both mean the file isn't there
  const page404 = r.status() === 404;
  const appPage = body.length < 5000 && (r.headers()["content-type"] ?? "").includes("text/html");
  ok(page404 || appPage, `not published: ${p} (got ${r.status()}, ${body.length} bytes)`);
}
const n = await page.request.get(base + "/THIRD-PARTY-NOTICES.txt");
ok(n.ok() && (await n.text()).includes("Mediabunny"), "licence notices published");
await ctx.close();
