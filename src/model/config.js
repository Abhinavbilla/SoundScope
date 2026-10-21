// Everything model-specific lives here, so the model can be swapped later.
import labels from "./audioset-strong-labels.json";

// EfficientSED fmn10 + 2 transformer blocks (MIT), trained on AudioSet's time-stamped labels.
// Served from the site (public/models, copied from model-check/hf_upload_esed); the .gz copy is unpacked in the
// browser. Replaced frame_mn10 (spec.md).
export const MODEL = {
  // Also names saved results: change it whenever scores would come out different.
  id: "efficientsed-fmn10-tf256-hann5s",
  url: "/models/efficientsed_fmn10_tf256.onnx.gz", // served by the site itself (also on Hugging Face: Abhinavbilla/efficientsed-fmn10-tf256-onnx)
  gzip: true,
  sizeBytes: 19_197_656, // download size (gz)
  sha256: "109c26bab55dc45779250b0e2a02610d3c9cf6aad2e0a3791faad5eaa27b11f3", // unpacked .onnx
  sampleRate: 16000,
  // One output row every 40 ms. 10 s windows every 5 s, crossfaded with Hann weights: without
  // overlap the scores jump at every 10 s window edge (18x the normal row-to-row change on the TUT
  // street recordings); the crossfade removes that and was slightly more accurate (notes/timeline.md).
  stepSeconds: 0.04,
  windowSamples: 160_000, // 10 s -> 250 rows
  hopSamples: 80_000,
  rowsPerWindow: 250,
  rowWeights: hann(250), // weight of each row of a window where windows overlap
  inputName: "waveform",
  inputShape: (n) => [1, n],
  labels, // AudioSet strong label set, 447 classes
};

/** Hann weights without the zero ends (numpy: hanning(n + 2)[1:-1]). */
function hann(n) {
  return Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (n + 1)));
}

// Scores are stored as one byte each on a log scale from 1e-4 to 1 (0 means below 1e-4).
// Each step is about 3.7% of the score, fine for thresholds down to 0.001, and it costs
// 447 classes x 25 rows/s = about 40 MB per hour.
export const ScoreArray = Uint8Array;
const LOG_MIN = -4;

export function encodeScore(p) {
  if (!(p > 1e-4)) return 0;
  return Math.max(1, Math.min(255, Math.round(((Math.log10(p) - LOG_MIN) / -LOG_MIN) * 255)));
}

export function decodeScore(b) {
  return b === 0 ? 0 : 10 ** ((b / 255) * -LOG_MIN + LOG_MIN);
}
