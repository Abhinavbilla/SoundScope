import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// Cross-origin isolation: needed for multi-threaded ONNX Runtime (SharedArrayBuffer),
// and lets us read page memory with performance.measureUserAgentSpecificMemory().
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Device test page (device-test.html) posts its results here; we append them to a local file.
function deviceResults() {
  const handler = (req, res, next) => {
    if (req.method !== "POST" || req.url !== "/__device-result") return next();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      fs.mkdirSync("test-audio", { recursive: true });
      fs.appendFileSync("test-audio/device-results.jsonl", body.replace(/\n/g, " ") + "\n");
      res.statusCode = 204;
      res.end();
    });
  };
  return {
    name: "device-results",
    // Block bodies on purpose: a function returned from these hooks would be run as a post-hook.
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

// Point Mediabunny's MP3, ADTS and FLAC demuxers at our memory-fixed subclasses (src/vendor/,
// see mediabunny-frame-index.js). The subclasses import the originals through
// "virtual:mediabunny-original/<path>", which resolves straight to the file on disk
// (Mediabunny's package exports don't allow deep imports).
function mediabunnyFrameIndex() {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  const patches = {
    "mp3-demuxer.js": here("src/vendor/mediabunny-mp3.js"),
    "adts-demuxer.js": here("src/vendor/mediabunny-adts.js"),
    "flac-demuxer.js": here("src/vendor/mediabunny-flac.js"),
  };
  const ORIGINAL = "virtual:mediabunny-original/";
  return {
    name: "mediabunny-frame-index",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.startsWith(ORIGINAL)) return here(`node_modules/mediabunny/dist/modules/src/${source.slice(ORIGINAL.length)}`);
      if (!importer || !/[\\/]mediabunny[\\/]/.test(importer)) return null;
      return patches[source.split("/").pop()] ?? null;
    },
  };
}

// SS_NO_FRAME_INDEX=1 builds without the fix (to compare decoded audio byte for byte).
const frameIndex = () => (process.env.SS_NO_FRAME_INDEX ? [] : [mediabunnyFrameIndex()]);

// `vite build --mode site` (npm run build:site): the public build for Cloudflare Pages, in dist-site/. Only
// the app page (no device test page), only the app's model (public/ also holds local test models and
// samples that must not be published), the headers file, and the licence notices. Stops if the model
// file isn't the one config.js expects.
const SITE_MODEL = "efficientsed_fmn10_tf256.onnx.gz";
const NOTICES = [ // [name, licence, licence file]
  ["EfficientSED model weights (Morocutti, Schmid, Greif, Foscarin, Widmer)", "MIT", "site/efficientsed-LICENSE.txt"],
  ["ONNX Runtime Web", "MIT", "site/onnxruntime-LICENSE.txt"],
  ["React, React DOM", "MIT", "node_modules/react/LICENSE"],
  ["scheduler", "MIT", "node_modules/scheduler/LICENSE"],
  ["Mediabunny", "MPL-2.0 (source: https://github.com/Vanilagy/mediabunny)", "node_modules/mediabunny/LICENSE"],
  ["wavesurfer.js", "BSD-3-Clause", "node_modules/wavesurfer.js/LICENSE"],
  ["Lucide icons", "ISC", "node_modules/lucide-react/LICENSE"],
  ["Inter font", "SIL Open Font License 1.1", "node_modules/@fontsource-variable/inter/LICENSE"],
];

function sitePublish() {
  const here = (p) => fileURLToPath(new URL(p, import.meta.url));
  return {
    name: "site-publish",
    apply: "build",
    closeBundle() {
      const out = here("dist-site/");
      // drop everything public/ brought along except the app's model and the icon
      fs.rmSync(`${out}device-samples`, { recursive: true, force: true });
      for (const f of fs.readdirSync(`${out}models`)) if (f !== SITE_MODEL) fs.rmSync(`${out}models/${f}`);
      // expected URL, size and hash, read from config.js's text (it imports JSON, so it isn't imported here)
      const cfg = fs.readFileSync(here("src/model/config.js"), "utf8");
      const MODEL = {
        url: /^\s*url: "([^"]+)"/m.exec(cfg)?.[1] ?? "",
        sizeBytes: Number(/^\s*sizeBytes: ([\d_]+)/m.exec(cfg)?.[1].replace(/_/g, "")),
        sha256: /^\s*sha256: "([0-9a-f]+)"/m.exec(cfg)?.[1],
      };
      const gz = fs.readFileSync(`${out}models/${SITE_MODEL}`);
      const sha = crypto.createHash("sha256").update(zlib.gunzipSync(gz)).digest("hex");
      if (gz.length !== MODEL.sizeBytes || sha !== MODEL.sha256 || !MODEL.url.endsWith(`/models/${SITE_MODEL}`)) {
        throw new Error(`site build: models/${SITE_MODEL} isn't the model config.js expects (size ${gz.length}, sha256 ${sha})`);
      }
      fs.copyFileSync(here("site/_headers"), `${out}_headers`);
      const notices = NOTICES.map(([name, licence, file]) =>
        `${"=".repeat(78)}\n${name} — ${licence}\n${"=".repeat(78)}\n\n${fs.readFileSync(here(file), "utf8").trim()}\n`);
      fs.writeFileSync(`${out}THIRD-PARTY-NOTICES.txt`,
        "SoundScope uses the following software, model and data. Their licences are below.\n\n" +
        "Sound categories: AudioSet ontology by Google, CC BY-SA 4.0 (https://research.google.com/audioset/ontology/).\n\n" +
        notices.join("\n"));
    },
  };
}

export default defineConfig(({ mode }) => {
  const site = mode === "site";
  return {
    plugins: [react(), deviceResults(), ...frameIndex(), ...(site ? [sitePublish()] : [])],
    worker: { format: "es", plugins: () => frameIndex() },
    server: { headers: isolation },
    preview: { headers: isolation },
    build: {
      outDir: site ? "dist-site" : "dist",
      rollupOptions: {
        input: site
          ? { main: fileURLToPath(new URL("index.html", import.meta.url)) }
          : {
            main: fileURLToPath(new URL("index.html", import.meta.url)),
            deviceTest: fileURLToPath(new URL("device-test.html", import.meta.url)),
          },
      },
    },
  };
});
