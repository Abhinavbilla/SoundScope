// Where does page memory grow? Samples the analysis worker's JS heap (DevTools Runtime.getHeapUsage)
// and the page's renderer private memory while a file is processed.
// Needs `vite preview` on :4173. Usage: node tools/heap-probe.mjs <file> [decode-only]
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import path from "node:path";

const [file, mode] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: false,
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((decodeOnly) => {
  window.__soundscopeDebug = true;
  window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
  if (decodeOnly) window.__soundscopeDecodeOnly = true;
}, mode === "decode-only");
await page.goto("http://localhost:4173/");
const rendererPid = async () => {
  const info = await browser.target().createCDPSession().then((s) => s.send("SystemInfo.getProcessInfo"));
  return info.processInfo.filter((p) => p.type === "renderer").map((p) => p.id);
};
const privateMB = (pids) => {
  const out = execFileSync("powershell", ["-NoProfile", "-c",
    `(${pids.map((p) => `(Get-Process -Id ${p}).PrivateMemorySize64`).join("+")}) / 1MB`]).toString().trim();
  return Math.round(Number(out));
};

const input = await page.$("input[type=file]");
await input.uploadFile(path.resolve(file));
let worker = null;
for (let i = 0; i < 50 && !worker; i++) {
  worker = page.workers().find((w) => w.url().includes("analysis.worker"));
  if (!worker) await new Promise((r) => setTimeout(r, 200));
}
const pids = await rendererPid();
const t0 = Date.now();
const rows = [];
for (;;) {
  const done = await page.evaluate(() => !!window.__soundscopeLast).catch(() => true);
  let heap = null;
  try {
    const h = await worker.client.send("Runtime.getHeapUsage");
    heap = { usedMB: Math.round(h.usedSize / 1048576), totalMB: Math.round(h.totalSize / 1048576) };
  } catch {
    heap = null; // worker gone
  }
  const progress = await page.$eval(".progress p", (e) => e.textContent.trim()).catch(() => "done");
  rows.push({ s: Math.round((Date.now() - t0) / 1000), heap, rendererMB: privateMB(pids), progress });
  console.log(JSON.stringify(rows.at(-1)));
  if (done) break;
  await new Promise((r) => setTimeout(r, 10000));
}
await browser.close();
