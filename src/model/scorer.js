// Turns a stream of mono blocks into a score timeline: (optionally overlapping) windows,
// overlapping rows averaged (weighted by model.rowWeights if set), finished rows handed out as soon
// as no later window can touch them. A row covered by one window just gets that window's score.
import { ScoreArray, encodeScore } from "./config.js";

export class WindowScorer {
  /**
   * @param {object} model MODEL config
   * @param {(samples: Float32Array) => Promise<Float32Array>} runWindow returns rowsPerWindow x classes
   */
  constructor(model, runWindow) {
    this.model = model;
    this.runWindow = runWindow;
    this.classes = model.labels.length;
    const hopRows = model.hopSamples / (model.windowSamples / model.rowsPerWindow);
    if (!Number.isInteger(hopRows)) throw new Error("Hop must be a whole number of output rows");
    this.hopRows = hopRows;
    this.buf = new Float32Array(model.windowSamples); // samples from the current window start
    this.bufLen = 0;
    this.windowStartRow = 0; // row index of the current window start
    // Running sums for rows that later windows still overlap
    this.acc = new Float64Array(model.rowsPerWindow * this.classes);
    this.wsum = new Float64Array(model.rowsPerWindow); // sum of weights per row
    this.weights = model.rowWeights ?? new Float64Array(model.rowsPerWindow).fill(1);
    this.totalSamples = 0;
    this.emittedRows = 0;
  }

  /** Feed samples. Returns finished rows as a ScoreArray (rows x classes), possibly empty. */
  async push(block) {
    this.totalSamples += block.length;
    const out = [];
    let off = 0;
    while (off < block.length) {
      const n = Math.min(block.length - off, this.buf.length - this.bufLen);
      this.buf.set(block.subarray(off, off + n), this.bufLen);
      this.bufLen += n;
      off += n;
      if (this.bufLen === this.buf.length) {
        await this.#run(this.buf);
        out.push(this.#emit(this.hopRows));
        // Slide by one hop
        this.buf.copyWithin(0, this.model.hopSamples);
        this.bufLen -= this.model.hopSamples;
        this.windowStartRow += this.hopRows;
      }
    }
    return concatRows(out, this.classes);
  }

  /** Call at the end: scores the last partial window (zero-padded) and returns all remaining rows. */
  async flush() {
    const rowSamples = this.model.windowSamples / this.model.rowsPerWindow;
    const totalRows = Math.ceil(this.totalSamples / rowSamples);
    const remaining = totalRows - this.emittedRows;
    if (remaining <= 0) return new ScoreArray(0);
    // Run one more (zero-padded) window unless the last full window already reached the end.
    // The last full window started at windowStartRow - hopRows and covered rowsPerWindow rows.
    const hadWindow = this.emittedRows > 0;
    const coveredEnd = hadWindow ? this.windowStartRow - this.hopRows + this.model.rowsPerWindow : 0;
    const needRun = coveredEnd < totalRows && (hadWindow || this.bufLen > 0);
    if (needRun) {
      const padded = new Float32Array(this.buf.length);
      padded.set(this.buf.subarray(0, this.bufLen));
      await this.#run(padded);
    }
    return this.#emit(Math.min(remaining, this.model.rowsPerWindow));
  }

  async #run(samples) {
    const rows = await this.runWindow(samples); // rowsPerWindow x classes
    const C = this.classes;
    for (let r = 0; r < this.model.rowsPerWindow; r++) {
      const w = this.weights[r];
      this.wsum[r] += w;
      for (let c = 0; c < C; c++) this.acc[r * C + c] += w * rows[r * C + c];
    }
  }

  // Emit the first `count` rows (weighted average), then shift the running sums.
  #emit(count) {
    const C = this.classes;
    const out = new ScoreArray(count * C);
    for (let r = 0; r < count; r++) {
      const k = this.wsum[r] || 1;
      for (let c = 0; c < C; c++) {
        const v = this.acc[r * C + c] / k;
        out[r * C + c] = encodeScore(v);
      }
    }
    this.acc.copyWithin(0, count * C);
    this.acc.fill(0, (this.model.rowsPerWindow - count) * C);
    this.wsum.copyWithin(0, count);
    this.wsum.fill(0, this.model.rowsPerWindow - count);
    this.emittedRows += count;
    return out;
  }
}

function concatRows(parts, classes) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (parts.length === 1) return parts[0];
  const out = new ScoreArray(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
