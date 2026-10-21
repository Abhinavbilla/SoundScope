// Peak values (max |sample| per bucket) for drawing the waveform.

/** Peaks from a full sample array (used by the whole-file fallback). */
export function computePeaks(samples, buckets = 8000) {
  const n = Math.max(1, Math.min(buckets, samples.length));
  const peaks = new Float32Array(n);
  const size = samples.length / n;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * size);
    const end = Math.floor((b + 1) * size);
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  return peaks;
}

/** Shrink a peaks array to at most `buckets` values for display, keeping the maxima. */
export function downsamplePeaks(peaks, buckets = 10000) {
  if (peaks.length <= buckets) return peaks;
  return computePeaks(peaks, buckets);
}
