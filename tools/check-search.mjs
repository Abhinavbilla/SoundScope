// Step 5 checks in a real browser: type a search, see related sounds, put all matches on the
// timeline as one row, and compare that row's moments with labelled event times.
// Needs `vite preview` on :4173.
// Usage: node tools/check-search.mjs <labels.json> <file> [<file> ...]
//   labels.json: { "<file name without extension>": [{cls, onset, offset}] } (the synthetic mixes' labels)
// Env: SS_SHOTS=<dir> for screenshots, SS_BROWSER=msedge|chrome, SS_WIDTH
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [labelsPath, ...files] = process.argv.slice(2);
const labels = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
const QUERIES = { dog: "dog", door_wood_knock: "knock", glass_breaking: "glass", clapping: "clap" };
const shots = process.env.SS_SHOTS;
const ok = (cond, msg) => console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
const toSec = (t) => t.trim().split(":").reduce((a, x) => a * 60 + Number(x), 0);
const totals = {};

const dir = path.join(os.tmpdir(), "ssprobe-search-" + Date.now());
const ctx = await chromium.launchPersistentContext(dir, { channel: process.env.SS_BROWSER || "msedge", headless: false, viewport: { width: Number(process.env.SS_WIDTH) || 1100, height: 900 } });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx"; // SS_LOCAL_MODEL=1
}, !!process.env.SS_LOCAL_MODEL);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));

for (const file of files) {
  const name = path.basename(file).replace(/\.[^.]+$/, "");
  await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
  await page.setInputFiles("input[type=file]", file);
  await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 600_000 });
  await page.waitForTimeout(500);

  for (const [cls, q] of Object.entries(QUERIES)) {
    await page.fill("#search", q);
    await page.waitForTimeout(250);
    const res = await page.$eval(".search__results", (el) => ({
      head: el.querySelector(".search__head span")?.textContent ?? el.textContent,
      hits: [...el.querySelectorAll(".sounds__list li")].map((li) => ({
        name: li.querySelector(".sounds__name").textContent, heard: !li.classList.contains("search__unheard"),
      })),
    }));
    const group = page.locator(".search__head button");
    let moments = [];
    const single = !(await group.count());
    {
      if (single) await page.locator(".search__results input[type=checkbox]").first().check(); // one match: its own row
      else await group.click(); // adds the combined row and makes it active
      await page.waitForTimeout(700); // full detail loads from storage
      moments = await page.$$eval(".moment", (els) => els.map((b) => {
        const span = b.querySelector("span");
        const sound = span.querySelector(".moment__sound")?.textContent ?? "";
        return { range: span.textContent.slice(0, span.textContent.length - sound.length), sound };
      }));
    }
    const ms = moments.map((m) => ({ start: toSec(m.range.split("–")[0]), end: toSec(m.range.split("–")[1]), sound: m.sound }));
    const refs = labels[name].filter((e) => e.cls === cls);
    // an event is found if a moment overlaps it; a moment is extra if it overlaps no event of this kind
    const found = refs.filter((e) => ms.some((m) => m.start < e.offset + 1 && m.end > e.onset - 1));
    const extra = ms.filter((m) => !refs.some((e) => m.start < e.offset + 1 && m.end > e.onset - 1));
    const t = (totals[q] ??= { refs: 0, found: 0, moments: 0, extra: 0 });
    t.refs += refs.length; t.found += found.length; t.moments += ms.length; t.extra += extra.length;
    console.log(`${name} "${q}": ${res.head}; heard: ${res.hits.filter((h) => h.heard).map((h) => h.name.split(" · ")[0]).join(", ") || "none"}`);
    console.log(`      combined row: ${ms.length} moments ${JSON.stringify(ms.map((m) => [+m.start.toFixed(1), +m.end.toFixed(1), m.sound]))}; labelled ${JSON.stringify(refs.map((e) => [+e.onset.toFixed(1), +e.offset.toFixed(1)]))}; found ${found.length}/${refs.length}, extra ${extra.length}`);
    if (shots && q === "dog") await page.screenshot({ path: path.join(shots, `search-${name}.png`), fullPage: true });
    if (single) await page.locator(".search__results input[type=checkbox]").first().uncheck();
    else await page.locator(".search__head button").click(); // remove the combined row again
  }

  // a single match on/off, a query with no match, and a two-word query through a group name
  await page.fill("#search", "dog");
  await page.waitForTimeout(200);
  const rowsBefore = await page.$$eval(".trow", (r) => r.length);
  await page.locator(".search__results input[type=checkbox]").first().check();
  const rowsOn = await page.$$eval(".trow", (r) => r.length);
  await page.locator(".search__results input[type=checkbox]").first().uncheck();
  const rowsOff = await page.$$eval(".trow", (r) => r.length);
  ok(rowsOn === rowsBefore + 1 && rowsOff === rowsBefore, `${name}: tick a match adds a row, untick removes it (${rowsBefore} -> ${rowsOn} -> ${rowsOff})`);
  await page.fill("#search", "xyzzy");
  await page.waitForTimeout(200);
  ok((await page.textContent(".search__results")).includes("No sound called"), `${name}: no-match message`);
  await page.fill("#search", "door knock");
  await page.waitForTimeout(200);
  const dk = await page.$$eval(".search__results .sounds__name", (els) => els.map((e) => e.textContent));
  ok(dk.some((n) => n.startsWith("Knock")), `${name}: "door knock" -> ${JSON.stringify(dk)}`);
  await page.fill("#search", "");
}

// play a moment of a combined row: from its start
await page.fill("#search", "dog");
await page.waitForTimeout(200);
await page.locator(".search__head button").click();
await page.waitForTimeout(700);
const first = page.locator(".moment").first();
if (await first.count()) {
  const start = toSec((await first.locator("span").first().textContent()).split("–")[0]); // the start comes first
  await first.click();
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => ({ t: window.__soundscopePlayer.time(), playing: window.__soundscopePlayer.playing() }));
  ok(p.playing && p.t >= start - 0.1 && p.t < start + 0.6, `combined row moment at ${start.toFixed(1)} s -> playing from ${p.t.toFixed(2)} s`);
}

console.log("\nTotals (an event counts as found if a moment overlaps it, 1 s slack):");
for (const [q, t] of Object.entries(totals)) {
  console.log(`  "${q}": found ${t.found}/${t.refs} labelled events, ${t.moments} moments, ${t.extra} with no labelled event`);
}
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
