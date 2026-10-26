// Turn a sound's scores into time intervals: rows at or above the threshold, joined when the gap
// between them is shorter than `mergeGap`, then dropped if shorter than `minLength`.
// Scores are the stored bytes (log scale, see config.js), so the threshold is compared as a byte too.
import { decodeScore, encodeScore } from "../model/config.js";

export const SETTINGS = {
  mergeGap: 1, // seconds: detections closer than this become one
  minLength: 0.12, // seconds: shorter events are dropped (0.5 s lost short sounds like a single bark; notes/search.md)
};

// Sensitivity slider: threshold on a log scale. Best thresholds for frame_mn10 (the earlier model) on the TUT street
// recordings were 0.01-0.05 per sound (up to 0.2 for exact starts), so 0.05 is the starting value.
export const THRESHOLD = { min: 0.001, max: 0.5, start: 0.05 };

/**
 * @param {Uint8Array} timeline one byte per row for one sound
 * @param {number} step seconds per row (0.04 full detail, 1 for the overview)
 * @param {number} threshold score 0..1
 * @param {{duration?: number, mergeGap?: number, minLength?: number}} [opts]
 * @returns {{start: number, end: number, confidence: number, peak: number}[]} confidence = highest score
 *   inside, peak = time of the row where it is reached
 */
export function findIntervals(timeline, step, threshold, opts = {}) {
  const { duration = timeline.length * step, mergeGap = SETTINGS.mergeGap, minLength = SETTINGS.minLength } = opts;
  const thr = Math.max(1, encodeScore(threshold));
  const out = [];
  let cur = null; // { a, b, max, at } in rows, b exclusive; at = row of the max
  for (let i = 0; i < timeline.length; i++) {
    const v = timeline[i];
    if (v < thr) continue;
    if (cur && (i - cur.b) * step < mergeGap) {
      cur.b = i + 1;
      if (v > cur.max) { cur.max = v; cur.at = i; }
    } else {
      if (cur) push(cur);
      cur = { a: i, b: i + 1, max: v, at: i };
    }
  }
  if (cur) push(cur);
  return out;

  function push({ a, b, max, at }) {
    const start = a * step;
    const end = Math.min(b * step, duration);
    if (end - start >= minLength) out.push({ start, end, confidence: decodeScore(max), peak: at * step });
  }
}

/** One sound's column from a row-major matrix (rows x classes). */
export function column(matrix, classes, c) {
  const rows = Math.floor(matrix.length / classes);
  const out = new Uint8Array(rows);
  for (let r = 0, i = c; r < rows; r++, i += classes) out[r] = matrix[i];
  return out;
}

/** Several sounds as one timeline: the highest of their scores in each row. */
export function maxOf(timelines) {
  const out = new Uint8Array(timelines[0]?.length ?? 0);
  for (const tl of timelines) for (let i = 0; i < out.length; i++) if (tl[i] > out[i]) out[i] = tl[i];
  return out;
}

/** The highest byte in one sound's column of a row-major matrix. */
export function columnMax(matrix, classes, c) {
  let m = 0;
  for (let i = c; i < matrix.length; i += classes) if (matrix[i] > m) m = matrix[i];
  return m;
}

/**
 * Every sound heard in a 1-second overview (rows x classes) at this threshold, most heard first.
 * One pass over the matrix, so it stays fast for 10 h files (36,000 rows).
 * @returns {{c: number, seconds: number, events: number, max: number}[]} seconds = seconds with the sound,
 *   events = separate stretches of it (1 s detail), max = highest score (0..1)
 */
export function soundsHeard(overview, classes, threshold) {
  const thr = Math.max(1, encodeScore(threshold));
  const seconds = new Uint32Array(classes);
  const events = new Uint32Array(classes);
  const max = new Uint8Array(classes);
  const prev = new Uint8Array(classes); // was the sound present in the previous second?
  for (let i = 0; i < overview.length; i += classes) {
    for (let c = 0; c < classes; c++) {
      const v = overview[i + c];
      if (v > max[c]) max[c] = v;
      if (v >= thr) {
        seconds[c]++;
        if (!prev[c]) events[c]++;
        prev[c] = 1;
      } else prev[c] = 0;
    }
  }
  const out = [];
  for (let c = 0; c < classes; c++) {
    if (seconds[c]) out.push({ c, seconds: seconds[c], events: events[c], max: decodeScore(max[c]) });
  }
  return out.sort((a, b) => b.seconds - a.seconds || b.max - a.max);
}

/** Slider position 0..1 <-> threshold, log scale. */
export function thresholdAt(pos) {
  return THRESHOLD.min * (THRESHOLD.max / THRESHOLD.min) ** pos;
}
export function positionOf(threshold) {
  return Math.log(threshold / THRESHOLD.min) / Math.log(THRESHOLD.max / THRESHOLD.min);
}

/**
 * How sure a detection is, in words, for people (no raw scores in the UI): how far the highest score
 * gets above the current threshold, on a log scale. level 1..3 = Maybe / Likely / Very likely.
 */
export function strength(confidence, threshold) {
  const r = (Math.log(confidence) - Math.log(threshold)) / -Math.log(threshold);
  const level = r > 0.5 ? 3 : r > 0.2 ? 2 : 1;
  return { level, word: ["Maybe", "Likely", "Very likely"][level - 1] };
}
