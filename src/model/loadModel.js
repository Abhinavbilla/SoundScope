// Download the model once (kept in the Cache API afterwards) and create an ONNX Runtime session.
// Runs inside the worker.
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

const CACHE_NAME = "soundscope-models-v1"; // keyed by model URL
const MAX_THREADS = 4; // measured with Cnn14: 4 threads ~3.0 s/min, 8 threads ~2.8 s/min

ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(MAX_THREADS, (navigator.hardwareConcurrency || 2) - 1))
  : 1;

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchModelBytes(model, onProgress) {
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(model.url);
    if (hit) return { bytes: new Uint8Array(await hit.arrayBuffer()), fromCache: true };
  } catch {
    cache = null; // Cache API unavailable (e.g. private mode): just download
  }
  const res = await fetch(model.url);
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || model.sizeBytes;
  // Count downloaded (compressed) bytes for progress, then unpack if needed.
  let got = 0;
  const counted = res.body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      got += chunk.length;
      onProgress?.(got, total);
      ctrl.enqueue(chunk);
    },
  }));
  let data = new Uint8Array(await new Response(counted).arrayBuffer());
  // Unpack only if it's still gzip (1f 8b): a host may already have sent it with Content-Encoding: gzip.
  if (model.gzip && data[0] === 0x1f && data[1] === 0x8b) {
    data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  if (model.sha256 && (await sha256Hex(data)) !== model.sha256) {
    throw new Error("Model download is corrupted (checksum mismatch)");
  }
  if (cache) {
    try {
      await cache.put(model.url, new Response(data, { headers: { "content-type": "application/octet-stream" } }));
    } catch {
      // Storage full or blocked: the model still works, it just downloads again next time.
    }
  }
  return { bytes: data, fromCache: false };
}

/** Test only: override the thread count (must be called before loadModel). */
export function setThreads(n) {
  if (n > 0) ort.env.wasm.numThreads = self.crossOriginIsolated ? n : 1;
}

/** @returns {Promise<{session: ort.InferenceSession, fromCache: boolean, threads: number}>} */
export async function loadModel(model, onProgress) {
  const { bytes, fromCache } = await fetchModelBytes(model, onProgress);
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  return { session, fromCache, threads: ort.env.wasm.numThreads };
}

export function makeInput(model, samples) {
  return { [model.inputName]: new ort.Tensor("float32", samples, model.inputShape(samples.length)) };
}
