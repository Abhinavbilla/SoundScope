// Phone / browser self-test: capabilities, the six formats through the real decode pipeline,
// model speed for both candidates, and an optional 20-minute full-pipeline run.
// Results are shown on the page and POSTed to the serving machine (/__device-result).
import "./styles.css";
import { openAudioFile } from "./audio/openFile.js";

const FORMATS = ["mp3", "m4a", "aac", "flac", "ogg", "wav"];
const report = { startedAt: new Date().toISOString(), caps: {}, formats: {}, models: {}, long: null };
const $ = (id) => document.getElementById(id);

function row(list, key, value, bad = false) {
  const li = document.createElement("li");
  li.innerHTML = `<span>${key}</span><span class="${bad ? "bad" : ""}"></span>`;
  li.lastChild.textContent = value;
  $(list).appendChild(li);
  return li;
}

async function send() {
  try {
    await fetch("/__device-result", { method: "POST", body: JSON.stringify(report) });
  } catch {
    // Not served by our preview server: results are still on screen.
  }
}

// ---- capabilities ----
const caps = report.caps;
caps.userAgent = navigator.userAgent;
caps.secureContext = self.isSecureContext;
caps.crossOriginIsolated = self.crossOriginIsolated;
caps.cpuThreads = navigator.hardwareConcurrency ?? null;
caps.deviceMemoryGB = navigator.deviceMemory ?? null;
caps.webCodecsAudio = typeof AudioDecoder !== "undefined";
caps.cacheApi = typeof caches !== "undefined";
caps.screen = `${screen.width}×${screen.height} @${devicePixelRatio}x`;
row("caps", "Browser", navigator.userAgent);
row("caps", "Secure context", String(caps.secureContext), !caps.secureContext);
row("caps", "Multi-threading (cross-origin isolated)", String(caps.crossOriginIsolated), !caps.crossOriginIsolated);
row("caps", "CPU threads", String(caps.cpuThreads ?? "unknown"));
row("caps", "Memory (approx.)", caps.deviceMemoryGB ? `${caps.deviceMemoryGB} GB` : "not reported");
row("caps", "WebCodecs audio decoder", String(caps.webCodecsAudio), !caps.webCodecsAudio);
row("caps", "Cache API", String(caps.cacheApi), !caps.cacheApi);
row("caps", "Screen", caps.screen);
send();

// ---- formats + models ----
function benchModel(name, li) {
  return new Promise((resolve) => {
    const w = new Worker(new URL("./workers/bench.worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.type === "progress") {
        li.lastChild.textContent = `downloading ${Math.round(data.loaded / 1048576)} of ${Math.round(data.total / 1048576)} MB…`;
        return;
      }
      w.terminate();
      resolve(data);
    };
    w.postMessage({ name });
  });
}

$("run").onclick = async () => {
  $("run").disabled = true;
  $("out").innerHTML = "";
  for (const ext of FORMATS) {
    const li = row("out", ext.toUpperCase(), "decoding…");
    const t0 = performance.now();
    try {
      const blob = await (await fetch(`/device-samples/clip.${ext}`)).blob();
      const file = new File([blob], `clip.${ext}`, { type: blob.type });
      const r = await openAudioFile(file, { analyse: false }).promise;
      const ms = performance.now() - t0;
      report.formats[ext] = { ok: true, path: r.path, duration: +r.duration.toFixed(2), ms: Math.round(ms) };
      li.lastChild.textContent = `ok (${r.path}), ${r.duration.toFixed(1)} s in ${(ms / 1000).toFixed(2)} s`;
    } catch (e) {
      report.formats[ext] = { ok: false, error: e?.message ?? String(e) };
      li.lastChild.textContent = `failed: ${e?.message ?? e}`;
      li.lastChild.className = "bad";
    }
  }
  send();
  for (const name of ["efficientsed", "cnn14_int8"]) {
    const li = row("out", `Model ${name}`, "loading…");
    const r = await benchModel(name, li);
    report.models[name] = r;
    li.lastChild.textContent = r.type === "done"
      ? `${(r.msPerMinute / 1000).toFixed(2)} s per minute of ${name === "clip_vision" ? "video" : "audio"} · ${r.threads} thread(s) · loaded in ${(r.loadMs / 1000).toFixed(1)} s${r.fromCache ? " (cache)" : ""}`
      : `failed: ${r.message}`;
    if (r.type !== "done") li.lastChild.className = "bad";
    send();
  }
  $("run").disabled = false;
};

// ---- long file: 20 min generated on the device (no big download) ----
function makeWav(minutes, sampleRate = 44100) {
  const n = minutes * 60 * sampleRate;
  const header = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); header.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true); header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  str(36, "data"); header.setUint32(40, n * 2, true);
  const parts = [header.buffer];
  const chunk = sampleRate * 10;
  for (let s = 0; s < n; s += chunk) {
    const len = Math.min(chunk, n - s);
    const a = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const t = (s + i) / sampleRate;
      const beep = (t % 7) < 0.3 ? 0.3 * Math.sin(2 * Math.PI * 880 * t) : 0; // a short tone every 7 s
      a[i] = ((Math.random() * 2 - 1) * 0.05 + beep) * 32767;
    }
    parts.push(a.buffer);
  }
  return new File(parts, `generated-${minutes}min.wav`, { type: "audio/wav" });
}

$("long").onclick = async () => {
  $("long").disabled = true;
  $("longout").innerHTML = "";
  const li = row("longout", "20 min WAV", "building…");
  const t0 = performance.now();
  try {
    const file = makeWav(20);
    const job = openAudioFile(file, {
      onProgress: (s) => { li.lastChild.textContent = `${Math.floor(s / 60)} of 20 min…`; },
      onModel: (m) => {
        if (m.stage === "downloading") li.lastChild.textContent = `downloading model ${Math.round(m.loaded / 1048576)} MB…`;
      },
    });
    const r = await job.promise;
    const ms = performance.now() - t0;
    report.long = { ok: true, path: r.path, seconds: r.duration, totalMs: Math.round(ms), timings: r.timings };
    li.lastChild.textContent = `ok in ${(ms / 1000).toFixed(0)} s (model ${(r.timings.inferenceMs / 1000 / 20).toFixed(2)} s/min)`;
  } catch (e) {
    report.long = { ok: false, error: e?.message ?? String(e), afterMs: Math.round(performance.now() - t0) };
    li.lastChild.textContent = `failed: ${e?.message ?? e}`;
    li.lastChild.className = "bad";
  }
  send();
  $("long").disabled = false;
};
