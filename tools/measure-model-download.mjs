// How long a fresh browser takes to download the model from a site, and over which protocol (h3 = HTTP/3).
// Pass --disable-quic to force HTTP/2 for comparison.
// Usage: node tools/measure-model-download.mjs <site url> [--disable-quic]
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const [base, ...args] = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), "ssdl-" + Date.now()), { channel: "msedge", headless: false, args });
const page = ctx.pages()[0];
await page.goto(base + "/");
const r = await page.evaluate(async () => {
  const url = "/models/efficientsed_fmn10_tf256.onnx.gz";
  const t = performance.now();
  const b = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
  const ms = performance.now() - t;
  const e = performance.getEntriesByType("resource").find((x) => x.name.endsWith(url));
  return { bytes: b.byteLength, seconds: +(ms / 1000).toFixed(1), protocol: e?.nextHopProtocol };
});
console.log(`${base}: ${r.bytes} bytes in ${r.seconds} s over ${r.protocol}${args.length ? ` (${args.join(" ")})` : ""}`);
await ctx.close();
