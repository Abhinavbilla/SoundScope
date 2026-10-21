// Can the app's page (cross-origin isolated) download a ~100 MB file from Hugging Face, how long
// does it take on this network, and does the Cache API keep it? Uses the same fetch + cache steps
// as src/model/loadModel.js. Our own model isn't uploaded yet, so this uses a public file of similar size.
// Needs `vite preview` on :4173. Usage: node tools/measure-hf.mjs [url]
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.argv[2] || "https://huggingface.co/Xenova/whisper-base/resolve/main/onnx/decoder_model_fp16.onnx";
const dir = path.join(os.tmpdir(), "ssprobe-hf-" + Date.now());
const ctx = await chromium.launchPersistentContext(dir, { channel: "msedge", headless: false });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto("http://localhost:4173/");

for (const visit of [1, 2]) {
  const r = await page.evaluate(async (url) => {
    const t0 = performance.now();
    const cache = await caches.open("soundscope-hf-test");
    const hit = await cache.match(url);
    if (hit) {
      const b = await hit.arrayBuffer();
      return { fromCache: true, bytes: b.byteLength, ms: performance.now() - t0, isolated: crossOriginIsolated };
    }
    const res = await fetch(url);
    const reader = res.body.getReader();
    let got = 0, firstByteMs = null;
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteMs === null) firstByteMs = performance.now() - t0;
      chunks.push(value);
      got += value.length;
    }
    const downloadMs = performance.now() - t0;
    await cache.put(url, new Response(new Blob(chunks)));
    const entry = performance.getEntriesByName(res.url).pop() || performance.getEntriesByName(url).pop();
    return {
      fromCache: false, status: res.status, bytes: got, firstByteMs, ms: downloadMs,
      transferBytes: entry?.transferSize ?? null, encoding: res.headers.get("content-encoding"),
      isolated: crossOriginIsolated,
    };
  }, url);
  const mbps = r.fromCache ? null : ((r.bytes * 8) / (r.ms / 1000) / 1e6).toFixed(1);
  console.log(`visit ${visit}: ${JSON.stringify(r)}${mbps ? `  => ${mbps} Mbit/s` : ""}`);
}
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
