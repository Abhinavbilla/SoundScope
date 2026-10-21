// Unit checks for src/results/intervals.js. Usage: node tools/test-intervals.mjs
import assert from "node:assert/strict";
import { register } from "node:module";

// The app imports JSON the Vite way (no import attribute); let Node do the same here.
register("data:text/javascript," + encodeURIComponent(`
export async function load(url, context, next) {
  if (url.endsWith(".json")) return next(url, { ...context, importAttributes: { type: "json" } });
  return next(url, context);
}`));
const { column, findIntervals, positionOf, soundsHeard, thresholdAt } = await import("../src/results/intervals.js");
const { encodeScore } = await import("../src/model/config.js");

const step = 0.04;
const tl = (spans, rows = 1000) => { // spans: [startRow, endRow, score]
  const a = new Uint8Array(rows);
  for (const [s, e, p] of spans) a.fill(encodeScore(p), s, e);
  return a;
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

// one event, 1 s long
let r = findIntervals(tl([[100, 125, 0.3]]), step, 0.05);
assert.equal(r.length, 1);
assert.ok(near(r[0].start, 4) && near(r[0].end, 5));
assert.ok(Math.abs(r[0].confidence - 0.3) / 0.3 < 0.04); // one byte step is ~3.7%

// below threshold: nothing
assert.equal(findIntervals(tl([[100, 125, 0.04]]), step, 0.05).length, 0);

// gap 0.96 s (< 1 s): merged; confidence = the higher one
r = findIntervals(tl([[100, 125, 0.3], [149, 174, 0.6]]), step, 0.05);
assert.equal(r.length, 1);
assert.ok(near(r[0].start, 4) && near(r[0].end, 174 * step));
assert.ok(r[0].confidence > 0.55);

// gap exactly 1 s: kept apart
r = findIntervals(tl([[100, 125, 0.3], [150, 175, 0.3]]), step, 0.05);
assert.equal(r.length, 2);

// shorter than 0.12 s (2 rows): dropped; 3 rows: kept; two 2-row bursts merged: kept
assert.equal(findIntervals(tl([[100, 102, 0.3]]), step, 0.05).length, 0);
assert.equal(findIntervals(tl([[100, 103, 0.3]]), step, 0.05).length, 1);
r = findIntervals(tl([[100, 102, 0.3], [110, 112, 0.3]]), step, 0.05);
assert.equal(r.length, 1);
assert.ok(near(r[0].end - r[0].start, 12 * step));

// peak: time of the highest row
r = findIntervals(tl([[100, 125, 0.1], [110, 111, 0.6]]), step, 0.05);
assert.ok(near(r[0].peak, 110 * step));

// event running to the end: end clamped to the real duration
r = findIntervals(tl([[980, 1000, 0.3]]), step, 0.05, { duration: 39.97 });
assert.ok(near(r[0].end, 39.97));

// overview (1 s rows): each second counts, adjacent seconds are one event
r = findIntervals(tl([[3, 5, 0.3], [6, 7, 0.3]], 10), 1, 0.05);
assert.deepEqual(r.map((x) => [x.start, x.end]), [[3, 5], [6, 7]]);

// soundsHeard on a 3-class overview, and column()
const classes = 3;
const ov = new Uint8Array(6 * classes);
const set = (row, c, p) => { ov[row * classes + c] = encodeScore(p); };
set(0, 1, 0.2); set(1, 1, 0.2); set(3, 1, 0.2); set(5, 2, 0.9); set(2, 0, 0.01);
const h = soundsHeard(ov, classes, 0.05);
assert.deepEqual(h.map((x) => [x.c, x.seconds, x.events]), [[1, 3, 2], [2, 1, 1]]);
assert.deepEqual([...column(ov, classes, 1)].map((v) => (v ? 1 : 0)), [1, 1, 0, 1, 0, 0]);
assert.equal(soundsHeard(ov, classes, 0.005).length, 3);

// slider mapping round trip, ends of the range
assert.ok(near(thresholdAt(0), 0.001) && near(thresholdAt(1), 0.5));
assert.ok(near(positionOf(thresholdAt(0.37)), 0.37));

// speed: a 10 h full-detail timeline (900,000 rows)
const big = new Uint8Array(900_000);
for (let i = 0; i < big.length; i++) big[i] = (i % 500) < 40 ? 200 : 10;
let t = performance.now();
r = findIntervals(big, step, 0.05);
console.log(`10 h timeline: ${r.length} intervals in ${(performance.now() - t).toFixed(1)} ms`);
const ov10h = new Uint8Array(36_000 * 447);
for (let i = 0; i < ov10h.length; i++) ov10h[i] = (i * 2654435761) % 256;
t = performance.now();
soundsHeard(ov10h, 447, 0.05);
console.log(`10 h overview, all 447 sounds: ${(performance.now() - t).toFixed(1)} ms`);
console.log("all interval checks passed");
