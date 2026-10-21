// Run files through the app and save what the model saw (samples) and produced (scores),
// so tools/verify_scores.py can recompute the scores in Python and compare.
// Needs `vite preview` on :4173 (or SS_PORT). Usage: node tools/dump-scores.mjs <outDir> <file> [<file> ...]
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [outDir, ...files] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const b64ToFile = (b64, p) => fs.writeFileSync(p, Buffer.from(b64, "base64"));

for (const file of files) {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("  console:", m.text().slice(0, 200)); });
  // SS_NO_SAMPLES=1: only save scores (faster for long files; the app still collects the samples, they just aren't copied out)
  // SS_LOCAL_MODEL=1: load the model from /models/ (e.g. offline) instead of Hugging Face
  // SS_MODEL_URL + SS_MODEL_SHA256: run another model with the same interface (to compare models)
  await page.addInitScript(([collect, local, url, sha]) => {
    window.__soundscopeDebug = true; window.__soundscopeCollect = collect;
    if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
    if (url) { window.__soundscopeModelUrl = url; window.__soundscopeModelSha256 = sha; }
  }, [true, !!process.env.SS_LOCAL_MODEL, process.env.SS_MODEL_URL || "", process.env.SS_MODEL_SHA256 || ""]);
  await page.goto(`http://localhost:${process.env.SS_PORT || 4173}/`);
  await page.setInputFiles("input[type=file]", file);
  await page.waitForFunction(() => window.__soundscopeLast, null, { timeout: 30 * 60_000, polling: 500 });
  const r = await page.evaluate((noSamples) => {
    const b64 = (a) => {
      const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let s = "";
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const last = window.__soundscopeLast;
    if (!last.ok) return { last };
    return { last, scores: b64(window.__soundscopeScores), samples: window.__soundscopeSamples && !noSamples ? b64(window.__soundscopeSamples) : null };
  }, !!process.env.SS_NO_SAMPLES);
  // SS_KEEP_EXT=1 keeps the extension in output names (same file in several formats)
  const base = process.env.SS_KEEP_EXT ? path.basename(file).replace(/\./g, "_") : path.basename(file).replace(/\.\w+$/, "");
  if (r.scores) b64ToFile(r.scores, path.join(outDir, `${base}.scores.u8`));
  if (r.samples) b64ToFile(r.samples, path.join(outDir, `${base}.samples.f32`));
  console.log(JSON.stringify({ file: base, ...r.last }));
  await page.close();
}
await browser.close();
