// Notes in search and clip names: add bookmarks with notes, find them from the search bar (click plays
// from the bookmark's start), a note word isn't turned into a sound-name guess, and a clip's file name has the note.
// Needs `vite preview` on :4173. Usage: node tools/check-note-search.mjs <outDir> <file> [screenshot.png]
// Env: SS_LOCAL_MODEL=1, SS_WIDTH
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [outDir, file, shot] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };
const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), "ssprobe-notes-" + Date.now()), {
  channel: "msedge", headless: false, acceptDownloads: true, viewport: { width: Number(process.env.SS_WIDTH) || 1280, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.addInitScript((local) => {
  window.__soundscopeDebug = true;
  if (local) window.__soundscopeModelUrl = "/models/efficientsed_fmn10_tf256.onnx";
  window.showDirectoryPicker = undefined; // one download per clip
}, !!process.env.SS_LOCAL_MODEL);
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
await page.goto((process.env.SS_BASE || "http://localhost:4173") + "/");
await page.setInputFiles("input[type=file]", file);
await page.waitForFunction(() => window.__soundscopeLast && window.__soundscopePlayer, null, { timeout: 600_000 });
await page.waitForTimeout(500);

const pause = () => page.evaluate(() => { if (window.__soundscopePlayer.playing()) window.__soundscopePlayer.toggle(); });
const notes = [[12, "Riya laughing at the cake"], [30, "mama said hi"], [45, "neighbour's dog again"]];
await page.click('.tab:has-text("Bookmarks")');
for (const [t, note] of notes) {
  await page.evaluate((t) => window.__soundscopePlayer.playFrom(t), t);
  await page.waitForTimeout(150);
  await pause();
  await page.click("text=Bookmark this point");
  await page.waitForTimeout(250);
  const field = page.locator(".bookmark__note").last();
  await field.fill(note);
  await field.press("Enter");
  await page.waitForTimeout(250);
}
const saved = await page.$$eval(".bookmark__note", (els) => els.map((e) => e.value));
ok(notes.every(([, n]) => saved.includes(n)), `3 bookmarks with notes: ${JSON.stringify(saved)}`);

ok((await page.getAttribute("#search", "placeholder")).includes("note"), `placeholder mentions notes: "${await page.getAttribute("#search", "placeholder")}"`);

await page.fill("#search", "cake");
await page.waitForTimeout(400);
const hit = await page.$$eval(".note-hit", (els) => els.map((e) => e.textContent));
ok(hit.length === 1 && hit[0].includes("Riya laughing at the cake"), `"cake" -> ${JSON.stringify(hit)}`);
if (shot) await page.screenshot({ path: shot });
await page.click(".note-hit");
await page.waitForTimeout(500);
const s = await page.evaluate(() => ({ t: window.__soundscopePlayer.time(), playing: window.__soundscopePlayer.playing(),
  open: !!document.querySelector(".search__results") }));
ok(s.playing && s.t > 11.9 && s.t < 12.7 && !s.open, `click plays from 0:12 -> ${s.t.toFixed(2)} s, results closed: ${!s.open}`);
await pause();

await page.fill("#search", "DOG neighbour");
await page.waitForTimeout(400);
const both = await page.evaluate(() => ({ notes: document.querySelectorAll(".note-hit").length, sounds: document.querySelectorAll(".search__list li").length }));
ok(both.notes === 1 && both.sounds === 0, `"DOG neighbour" (any case, any order): ${both.notes} note, ${both.sounds} sounds (no sound has both words)`);

await page.fill("#search", "dog");
await page.waitForTimeout(400);
const dog = await page.evaluate(() => ({ notes: document.querySelectorAll(".note-hit").length, sounds: document.querySelectorAll(".search__list li").length }));
ok(dog.notes === 1 && dog.sounds > 0, `"dog": ${dog.notes} note above ${dog.sounds} sounds`);

await page.fill("#search", "mama");
await page.waitForTimeout(400);
const mama = await page.evaluate(() => ({ notes: document.querySelectorAll(".note-hit").length,
  fix: !!document.querySelector(".search__fix"), sounds: document.querySelectorAll(".search__list li").length }));
ok(mama.notes === 1 && !mama.fix && mama.sounds === 0, `"mama": note found, no sound-name guess (${JSON.stringify(mama)})`);

for (const [typed, note] of [["ckae", "Riya laughing at the cake"], ["neigbor", "neighbour's dog again"]]) {
  await page.fill("#search", typed);
  await page.waitForTimeout(400);
  const t = await page.$$eval(".note-hit", (els) => els.map((e) => e.textContent));
  ok(t.length === 1 && t[0].includes(note), `typo "${typed}" -> ${JSON.stringify(t)}`);
}
await page.fill("#search", "dgo");
await page.waitForTimeout(400);
const dgo = await page.evaluate(() => ({ notes: document.querySelectorAll(".note-hit").length, sounds: document.querySelectorAll(".search__list li").length }));
ok(dgo.notes === 1 && dgo.sounds > 0, `"dgo": the dog note and the dog sounds both shown (${JSON.stringify(dgo)})`);

await page.fill("#search", "rain");
await page.waitForTimeout(400);
ok((await page.$$(".search__notes")).length === 0, `"rain" (in no note): search looks as before, no bookmarks section`);
await page.fill("#search", "");

// clip name has the note
await page.click('.tab:has-text("Bookmarks")');
const dl = page.waitForEvent("download");
const row = await page.$$eval(".bookmark__note", (els) => els.findIndex((e) => e.value === "Riya laughing at the cake"));
await page.locator(".bookmark").nth(row).locator("button", { hasText: "Clip" }).click();
const d = await dl;
const name = d.suggestedFilename();
await d.saveAs(path.join(outDir, name));
ok(/-Riya-laughing-at-the-cake-0-1\d\.\d\.wav$/.test(name), `clip name: ${name}`);

// delete button: visible without hovering, deletes, and Undo brings the bookmark (and its note) back
await page.waitForFunction(() => /Clip saved/.test(document.querySelector(".toasts")?.textContent ?? ""));
await page.mouse.move(5, 5);
const del = await page.locator(".bookmark__remove").first().evaluate((el) => {
  const s = getComputedStyle(el), r = el.getBoundingClientRect(), svg = el.querySelector("svg")?.getBoundingClientRect();
  return { opacity: Number(s.opacity), visible: s.visibility, w: r.width, icon: svg ? svg.width : 0, title: el.title };
});
ok(del.opacity === 1 && del.visible === "visible" && del.w >= 24 && del.icon > 0, `delete button shown without hover: ${JSON.stringify(del)}`);
const before = await page.$$eval(".bookmark__note", (els) => els.map((e) => e.value));
await page.locator(".bookmark__remove").first().click();
await page.waitForTimeout(400);
const after = await page.$$eval(".bookmark__note", (els) => els.map((e) => e.value));
const msg = await page.$eval(".toasts", (e) => e.textContent);
ok(after.length === before.length - 1 && /deleted/.test(msg) && /Undo/.test(msg), `delete: ${before.length} -> ${after.length}, "${msg}"`);
await page.click('.toasts button:has-text("Undo")');
await page.waitForTimeout(400);
const back = await page.$$eval(".bookmark__note", (els) => els.map((e) => e.value));
ok(back.length === before.length && before.every((n) => back.includes(n)), `undo: ${back.length} bookmarks, notes kept ${JSON.stringify(back)}`);
if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-bookmarks.png") });
await ctx.close();
