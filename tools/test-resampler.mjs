// Check the streaming resampler: chunked output == one-shot output, and quality on test tones.
// Usage: node tools/test-resampler.mjs
import { Resampler } from "../src/audio/resampler.js";

function run(input, inRate, outRate, chunk) {
  const r = new Resampler(inRate, outRate);
  const parts = [];
  for (let i = 0; i < input.length; i += chunk) parts.push(r.push(input.subarray(i, i + chunk)));
  parts.push(r.flush());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

let failed = false;
for (const inRate of [44100, 48000, 22050, 96000, 32000]) {
  const secs = 3;
  const n = inRate * secs;
  // 1 kHz tone at 0.5 amplitude + 15 kHz tone (above 32 kHz Nyquist of 16 kHz? no: below) + 20 kHz tone (must be removed)
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / inRate;
    x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * t) + (inRate > 40000 ? 0.3 * Math.sin(2 * Math.PI * 20000 * t) : 0);
  }
  const whole = run(x, inRate, 32000, n);
  const chunked = run(x, inRate, 32000, 4093); // odd chunk size on purpose
  let maxDiff = 0;
  for (let i = 0; i < whole.length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - chunked[i]));
  // Compare middle section with the ideal 1 kHz tone (20 kHz must be filtered out).
  let err = 0, sig = 0;
  for (let i = 3200; i < whole.length - 3200; i++) {
    const ideal = 0.5 * Math.sin(2 * Math.PI * 1000 * (i / 32000));
    err += (whole[i] - ideal) ** 2;
    sig += ideal ** 2;
  }
  const snr = 10 * Math.log10(sig / err);
  const expectedLen = Math.ceil((n * 32000) / inRate);
  const ok = whole.length === chunked.length && whole.length === expectedLen && maxDiff < 1e-6 && snr > 60;
  failed ||= !ok;
  console.log(`${inRate} Hz -> 32 kHz: length ${whole.length} (expected ${expectedLen}), chunked vs whole max diff ${maxDiff.toExponential(2)}, SNR vs ideal 1 kHz tone ${snr.toFixed(1)} dB ${ok ? "OK" : "FAIL"}`);
}
process.exit(failed ? 1 : 0);
