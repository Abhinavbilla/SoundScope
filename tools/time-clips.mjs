// Time clip export from a long file, without analysing it first (test hook __soundscopeClipTest).
// Needs `vite preview` on :4173. Usage: node tools/time-clips.mjs <file> <duration s> <at s> [<at s> ...]
import { chromium } from "playwright-core";
const [file, duration, ...ats] = process.argv.slice(2);
const b = await chromium.launch({ channel: process.env.SS_BROWSER || "msedge", headless: false });
const page = await b.newPage();
await page.addInitScript(() => { window.__soundscopeDebug = true; });
await page.goto("http://localhost:4173/");
await page.evaluate(() => { const i = document.createElement("input"); i.type = "file"; i.id = "cliptest"; document.body.append(i); });
await page.setInputFiles("#cliptest", file);
for (const at of ats) {
  const r = await page.evaluate(async ([at, duration]) => {
    const f = document.querySelector("#cliptest").files[0];
    return window.__soundscopeClipTest(f, [{ id: "a", start: Number(at), end: Number(at) + 1, label: "test" }], Number(duration));
  }, [at, duration]);
  console.log(`${file} clip at ${at} s: ${(r.ms / 1000).toFixed(2)} s, ${r.sizes.map((s) => s[1]).join(",")} bytes`);
}
await b.close();
