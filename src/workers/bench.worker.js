// Device test only: how fast does each candidate model run on this device?
// Uses the app's loader (same ONNX Runtime build, threads and caching).
import { MODEL } from "../model/config.js";
import { loadModel, makeInput } from "../model/loadModel.js";

const CANDIDATES = {
  efficientsed: { model: MODEL, window: MODEL.windowSamples, sampleRate: MODEL.sampleRate },
  // same model from the local copy (public/models), when Hugging Face can't be reached
  efficientsed_local: { model: { ...MODEL, url: "/models/efficientsed_fmn10_tf256.onnx", gzip: false }, window: MODEL.windowSamples, sampleRate: MODEL.sampleRate, perMinute: 12 },
  // previous model, for comparison (local copy in public/models, not on Hugging Face)
  cnn14_int8: {
    model: { url: "/models/cnn14_sed_int8.onnx", sizeBytes: 101_070_112, inputName: "waveform", inputShape: (n) => [1, n] },
    window: 327_680, // 10.24 s at 32 kHz
    sampleRate: 32_000,
  },
  // sound + picture test (notes/sound-and-picture.md): CLIP's image half, one frame every 2 s of video
  clip_vision: {
    model: { url: "/models/clip_b32_vision_int8.onnx", sizeBytes: 89_117_001, inputName: "pixel_values", inputShape: () => [1, 3, 224, 224] },
    window: 3 * 224 * 224,
    perMinute: 30,
  },
};

self.onmessage = async ({ data }) => {
  const c = CANDIDATES[data.name];
  try {
    const t0 = performance.now();
    const { session, fromCache, threads } = await loadModel(c.model, (loaded, total) =>
      self.postMessage({ type: "progress", loaded, total }));
    const loadMs = performance.now() - t0;
    // One minute of audio's (or video frames') worth of runs (noise is fine for timing).
    const windows = c.perMinute ?? Math.ceil((60 * c.sampleRate) / c.window);
    const x = new Float32Array(c.window);
    for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * 0.1;
    await session.run(makeInput(c.model, x)); // warm-up
    const t1 = performance.now();
    for (let w = 0; w < windows; w++) await session.run(makeInput(c.model, x));
    const msPerMinute = performance.now() - t1;
    self.postMessage({ type: "done", loadMs, fromCache, threads, msPerMinute });
  } catch (e) {
    self.postMessage({ type: "error", message: String(e?.message ?? e) });
  }
};
