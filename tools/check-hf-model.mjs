// From the app's cross-origin-isolated page: fetch the model from Hugging Face (plain and .gz),
// unpack the .gz with DecompressionStream, check both are identical, and run it once.
// Needs `vite preview` on :4173. Usage: node tools/check-hf-model.mjs
import { chromium } from "playwright-core";
const BASE = "https://huggingface.co/Abhinavbilla/efficientsed-fmn10-tf256-onnx/resolve/main/";
const browser = await chromium.launch({ channel: "msedge", headless: false });
const page = await browser.newPage();
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
const r = await page.evaluate(async (BASE) => {
  const sha = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
  let t = performance.now();
  const plain = await (await fetch(BASE + "efficientsed_fmn10_tf256.onnx")).arrayBuffer();
  const plainMs = performance.now() - t;
  t = performance.now();
  const res = await fetch(BASE + "efficientsed_fmn10_tf256.onnx.gz");
  const unpacked = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const gzMs = performance.now() - t;
  const labels = await (await fetch(BASE + "labels.json")).json();
  return { isolated: crossOriginIsolated, plainMB: plain.byteLength / 1e6, plainMs: Math.round(plainMs), gzMs: Math.round(gzMs),
    sameBytes: (await sha(plain)) === (await sha(unpacked)), sha: await sha(plain), labels: labels.length };
}, BASE);
console.log(JSON.stringify(r));
await browser.close();
