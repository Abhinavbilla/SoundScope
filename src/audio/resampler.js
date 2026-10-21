// Streaming resampler for mono audio: exact rational polyphase, Kaiser-windowed sinc.
// Works in a Web Worker (OfflineAudioContext isn't available there).
// Output sample n sits at input position n * M / L, where inRate / outRate = M / L.

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

export class Resampler {
  /**
   * @param {number} inRate
   * @param {number} outRate
   * @param {{halfTaps?: number, beta?: number}} [opts] halfTaps: filter half-width in output samples
   */
  constructor(inRate, outRate, { halfTaps = 16, beta = 8.6 } = {}) {
    const g = gcd(inRate, outRate);
    this.L = outRate / g; // phases
    this.M = inRate / g; // input step per L outputs
    this.passthrough = inRate === outRate;
    const cutoff = Math.min(1, outRate / inRate) * 0.95; // fraction of input Nyquist
    this.half = Math.ceil(halfTaps / cutoff); // half-width in input samples
    const width = 2 * this.half;
    this.width = width;

    // table[p * width + j] = weight of input sample (i0 - half + 1 + j) for phase p
    this.table = new Float32Array(this.L * width);
    const i0b = besselI0(beta);
    for (let p = 0; p < this.L; p++) {
      const frac = p / this.L;
      let sum = 0;
      for (let j = 0; j < width; j++) {
        const t = j - this.half + 1 - frac; // tap distance from the output position
        const x = cutoff * t;
        const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const r = t / this.half;
        const win = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) / i0b;
        const h = sinc * win;
        this.table[p * width + j] = h;
        sum += h;
      }
      for (let j = 0; j < width; j++) this.table[p * width + j] /= sum; // unity DC gain
    }

    // Pretend there are `half` zeros before the first input sample.
    this.buf = new Float32Array(this.half);
    this.bufStart = -this.half; // absolute input index of buf[0]
    this.inCount = 0; // input samples received
    this.outCount = 0; // output samples produced
  }

  /** Feed mono input, get the output samples that are now fully determined. */
  push(input) {
    if (this.passthrough) {
      this.inCount += input.length;
      this.outCount += input.length;
      return input.slice();
    }
    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    this.buf = merged;
    this.inCount += input.length;
    return this.#produce(this.bufStart + this.buf.length);
  }

  /** Call once at the end: pads with zeros and returns the remaining output. */
  flush() {
    if (this.passthrough) return new Float32Array(0);
    // Output n is real audio if its position n*M/L is inside the input.
    const total = Math.ceil((this.inCount * this.L) / this.M);
    const merged = new Float32Array(this.buf.length + this.half + 1);
    merged.set(this.buf);
    this.buf = merged;
    const out = this.#produce(this.bufStart + this.buf.length);
    const extra = Math.max(0, this.outCount - total);
    this.outCount -= extra;
    return out.subarray(0, out.length - extra);
  }

  #produce(availableEnd) {
    const { L, M, half, width, table } = this;
    // Largest n with floor(n*M/L) + half <= availableEnd - 1
    const lastIn = availableEnd - 1 - half;
    const nEnd = lastIn < 0 ? this.outCount : Math.floor((lastIn * L) / M) + 1;
    const count = Math.max(0, nEnd - this.outCount);
    const out = new Float32Array(count);
    const buf = this.buf;
    for (let k = 0; k < count; k++) {
      const n = this.outCount + k;
      const pos = n * M; // input position * L
      const i0 = Math.floor(pos / L);
      const p = pos - i0 * L;
      const base = i0 - half + 1 - this.bufStart;
      const t = p * width;
      let acc = 0;
      for (let j = 0; j < width; j++) acc += buf[base + j] * table[t + j];
      out[k] = acc;
    }
    this.outCount += count;
    // Drop input no longer needed by future outputs.
    const nextI0 = Math.floor((this.outCount * M) / L);
    const drop = nextI0 - half + 1 - this.bufStart;
    if (drop > 0) {
      this.buf = this.buf.slice(drop);
      this.bufStart += drop;
    }
    return out;
  }
}
